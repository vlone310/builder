/**
 * JSON Patch (RFC 6902). Edits travel between the editor, the host and the
 * Content API as patches; apply never mutates its input.
 */

export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; from: string; path: string }
  | { op: "copy"; from: string; path: string }
  | { op: "test"; path: string; value: unknown };

export class PatchError extends Error {
  constructor(
    message: string,
    readonly op: JsonPatchOp,
  ) {
    super(message);
    this.name = "PatchError";
  }
}

export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer "${pointer}"`);
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function toPointer(tokens: ReadonlyArray<string | number>): string {
  return tokens
    .map((token) => `/${String(token).replace(/~/g, "~0").replace(/\//g, "~1")}`)
    .join("");
}

type Container = Record<string, unknown> | unknown[];

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

function arrayIndex(token: string, length: number, allowEnd: boolean): number {
  if (token === "-" && allowEnd) return length;
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new Error(`Invalid array index "${token}"`);
  const index = Number(token);
  if (index > length || (!allowEnd && index === length)) {
    throw new Error(`Array index ${index} out of bounds`);
  }
  return index;
}

function getAt(doc: unknown, tokens: string[]): unknown {
  let current = doc;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      current = current[arrayIndex(token, current.length, false)];
    } else if (isContainer(current) && Object.hasOwn(current, token)) {
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(`Path "${toPointer(tokens)}" does not exist`);
    }
  }
  return current;
}

/** Returns a copy of doc with fn applied to the parent of the last token; copies only the path. */
function updateParent(
  doc: unknown,
  tokens: string[],
  fn: (parent: Container, last: string) => Container,
): unknown {
  if (tokens.length === 0) throw new Error("Cannot update the document root's parent");
  const [head, ...rest] = tokens as [string, ...string[]];
  if (!isContainer(doc)) throw new Error(`Cannot step into a non-container at "${head}"`);
  if (rest.length === 0) {
    return fn(Array.isArray(doc) ? [...doc] : { ...doc }, head);
  }
  if (Array.isArray(doc)) {
    const index = arrayIndex(head, doc.length, false);
    const copy = [...doc];
    copy[index] = updateParent(doc[index], rest, fn);
    return copy;
  }
  if (!Object.hasOwn(doc, head)) throw new Error(`Path segment "${head}" does not exist`);
  return { ...doc, [head]: updateParent((doc as Record<string, unknown>)[head], rest, fn) };
}

function add(doc: unknown, tokens: string[], value: unknown): unknown {
  if (tokens.length === 0) return value;
  return updateParent(doc, tokens, (parent, last) => {
    if (Array.isArray(parent)) {
      parent.splice(arrayIndex(last, parent.length, true), 0, value);
    } else {
      parent[last] = value;
    }
    return parent;
  });
}

function remove(doc: unknown, tokens: string[]): unknown {
  return updateParent(doc, tokens, (parent, last) => {
    if (Array.isArray(parent)) {
      parent.splice(arrayIndex(last, parent.length, false), 1);
    } else {
      if (!Object.hasOwn(parent, last))
        throw new Error(`Path "${toPointer(tokens)}" does not exist`);
      delete parent[last];
    }
    return parent;
  });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isContainer(a) || !isContainer(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

function applyOne(doc: unknown, op: JsonPatchOp): { doc: unknown; inverse: JsonPatchOp[] } {
  const tokens = parsePointer(op.path);
  switch (op.op) {
    case "add": {
      const parentTokens = tokens.slice(0, -1);
      const parent = tokens.length > 0 ? getAt(doc, parentTokens) : undefined;
      const last = tokens[tokens.length - 1];
      let inverse: JsonPatchOp[];
      if (tokens.length === 0) {
        inverse = [{ op: "replace", path: "", value: doc }];
      } else if (Array.isArray(parent)) {
        const index = arrayIndex(last as string, parent.length, true);
        inverse = [{ op: "remove", path: toPointer([...parentTokens, index]) }];
      } else if (isContainer(parent) && Object.hasOwn(parent, last as string)) {
        inverse = [
          {
            op: "replace",
            path: op.path,
            value: (parent as Record<string, unknown>)[last as string],
          },
        ];
      } else {
        inverse = [{ op: "remove", path: op.path }];
      }
      return { doc: add(doc, tokens, op.value), inverse };
    }
    case "remove": {
      const old = getAt(doc, tokens);
      return { doc: remove(doc, tokens), inverse: [{ op: "add", path: op.path, value: old }] };
    }
    case "replace": {
      const old = getAt(doc, tokens);
      const next =
        tokens.length === 0
          ? op.value
          : updateParent(doc, tokens, (parent, last) => {
              if (Array.isArray(parent)) parent[arrayIndex(last, parent.length, false)] = op.value;
              else parent[last] = op.value;
              return parent;
            });
      return { doc: next, inverse: [{ op: "replace", path: op.path, value: old }] };
    }
    case "move": {
      const fromTokens = parsePointer(op.from);
      if (op.path.startsWith(`${op.from}/`)) throw new Error("Cannot move a value into itself");
      if (op.from === op.path) return { doc, inverse: [] };
      const value = getAt(doc, fromTokens);
      const removed = remove(doc, fromTokens);
      const result = applyOne(removed, { op: "add", path: op.path, value });
      // Undo the add, then put the value back where it came from.
      return { doc: result.doc, inverse: [...result.inverse, { op: "add", path: op.from, value }] };
    }
    case "copy": {
      const value = getAt(doc, parsePointer(op.from));
      return applyOne(doc, { op: "add", path: op.path, value: structuredClone(value) });
    }
    case "test": {
      if (!deepEqual(getAt(doc, tokens), op.value)) throw new Error(`Test failed at "${op.path}"`);
      return { doc, inverse: [] };
    }
  }
}

/**
 * Applies ops in order and returns the new document plus the ops that undo
 * them. All-or-nothing: if any op fails, PatchError is thrown and the input is
 * untouched.
 */
export function applyPatch<T>(
  doc: T,
  ops: readonly JsonPatchOp[],
): { doc: T; inverse: JsonPatchOp[] } {
  let current: unknown = doc;
  const inverse: JsonPatchOp[] = [];
  for (const op of ops) {
    try {
      const result = applyOne(current, op);
      current = result.doc;
      inverse.unshift(...result.inverse);
    } catch (error) {
      throw new PatchError(error instanceof Error ? error.message : String(error), op);
    }
  }
  return { doc: current as T, inverse };
}
