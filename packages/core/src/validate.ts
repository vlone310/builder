import { type PageDocument, type PageNode, pageDocumentSchema, walkNodes } from "./document";
import { matchesComponentPattern, prepareNode, type Registry } from "./registry";

export const LIMITS = {
  maxNodes: 5000,
  maxDepth: 64,
} as const;

export type ValidationCode =
  | "invalid_document"
  | "too_many_nodes"
  | "too_deep"
  | "duplicate_node_id"
  | "invalid_type"
  | "unknown_component"
  | "unsupported_version"
  | "migration_failed"
  | "invalid_props"
  | "unknown_slot"
  | "slot_not_allowed"
  | "slot_full"
  | "placement"
  | "max_per_page";

export interface ValidationIssue {
  code: ValidationCode;
  message: string;
  nodeId?: string;
  /** Path inside the node's props, or inside the document for invalid_document. */
  path?: PropertyKey[];
}

export type ValidationResult =
  | { valid: true; document: PageDocument; issues: [] }
  | { valid: false; issues: ValidationIssue[] };

/**
 * Checks a page's structure. With a registry it also runs migrations and checks
 * props, slots and constraints against the components, which is what builder check
 * does for every stored page before a deploy.
 */
export function validatePage(input: unknown, registry?: Registry): ValidationResult {
  const parsed = pageDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "invalid_document",
        message: issue.message,
        path: issue.path,
      })),
    };
  }
  const document = parsed.data as PageDocument;
  const issues = validateTree(document.root, registry);
  return issues.length === 0 ? { valid: true, document, issues: [] } : { valid: false, issues };
}

function validateTree(root: PageNode, registry: Registry | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const counts = new Map<string, number>();
  let total = 0;

  for (const { node, parent, depth } of walkNodes(root)) {
    total++;
    if (total > LIMITS.maxNodes) {
      issues.push({
        code: "too_many_nodes",
        message: `Pages hold at most ${LIMITS.maxNodes} nodes`,
      });
      break;
    }
    if (depth > LIMITS.maxDepth) {
      issues.push({
        code: "too_deep",
        nodeId: node.id,
        message: `Nodes nest at most ${LIMITS.maxDepth} levels`,
      });
      continue;
    }
    if (seenIds.has(node.id)) {
      issues.push({
        code: "duplicate_node_id",
        nodeId: node.id,
        message: `Node id "${node.id}" is used twice`,
      });
    }
    seenIds.add(node.id);

    if (!registry) continue;

    const prepared = prepareNode(node, registry);
    if (!prepared.ok) {
      if (prepared.code === "invalid_props") {
        for (const issue of prepared.issues) {
          issues.push({
            code: "invalid_props",
            nodeId: node.id,
            path: issue.path,
            message: issue.message,
          });
        }
      } else {
        issues.push({ code: prepared.code, nodeId: node.id, message: prepared.message });
      }
    }
    const definition = prepared.definition;
    if (!definition) continue;

    counts.set(definition.id, (counts.get(definition.id) ?? 0) + 1);
    const { placement = "any", maxPerPage } = definition.constraints ?? {};
    if (placement === "root" && parent !== null) {
      issues.push({
        code: "placement",
        nodeId: node.id,
        message: `${definition.id} may only be the page root`,
      });
    }
    if (placement === "section" && parent === null) {
      issues.push({
        code: "placement",
        nodeId: node.id,
        message: `${definition.id} cannot be the page root`,
      });
    }
    if (maxPerPage !== undefined && counts.get(definition.id) === maxPerPage + 1) {
      issues.push({
        code: "max_per_page",
        nodeId: node.id,
        message: `${definition.id} may appear at most ${maxPerPage} times per page`,
      });
    }

    const slotConfigs = definition.slots ?? {};
    for (const [slot, children] of Object.entries(node.slots ?? {})) {
      const config = slotConfigs[slot];
      if (!config) {
        issues.push({
          code: "unknown_slot",
          nodeId: node.id,
          message: `${definition.id} has no slot "${slot}"`,
        });
        continue;
      }
      if (config.max !== undefined && children.length > config.max) {
        issues.push({
          code: "slot_full",
          nodeId: node.id,
          message: `Slot "${slot}" of ${definition.id} holds at most ${config.max} children`,
        });
      }
      if (!config.allow) continue;
      for (const child of children) {
        const childId = child.type.split("@")[0] ?? child.type;
        if (!config.allow.some((pattern) => matchesComponentPattern(childId, pattern))) {
          issues.push({
            code: "slot_not_allowed",
            nodeId: child.id,
            message: `${childId} is not allowed in slot "${slot}" of ${definition.id}`,
          });
        }
      }
    }
  }
  return issues;
}
