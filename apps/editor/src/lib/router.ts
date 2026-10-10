import { useSyncExternalStore } from "react";

/** A tiny hash router: #/sites/st_1, #/pages/pg_1?env=env_1. */
export interface Route {
  path: string[];
  query: URLSearchParams;
}

function read(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const [path = "/", query = ""] = hash.split("?");
  return { path: path.split("/").filter(Boolean), query: new URLSearchParams(query) };
}

let current = read();
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = read();
  for (const listener of listeners) listener();
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export function navigate(path: string) {
  window.location.hash = path;
}
