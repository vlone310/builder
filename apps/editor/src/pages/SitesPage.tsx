import { Globe } from "lucide-react";
import { useApi } from "../lib/session";
import { AppHeader } from "./AppHeader";
import { useAsync } from "./useAsync";

export function SitesPage() {
  const { api } = useApi();
  const sites = useAsync(() => api.sites(), [api]);
  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-3xl p-4 sm:p-8">
        <h1 className="mb-4 text-lg font-semibold">Sites</h1>
        {sites.error && <p className="text-danger">{sites.error.message}</p>}
        {sites.loading && !sites.data && <p className="text-muted">Loading…</p>}
        <ul className="grid gap-2">
          {sites.data?.items.map((site) => (
            <li key={site.id}>
              <a
                href={`#/sites/${site.id}`}
                className="flex items-center gap-3 rounded-lg border border-line bg-white p-4 hover:border-accent"
              >
                <Globe size={16} className="text-muted" />
                <span className="font-medium">{site.name}</span>
                <span className="ml-auto text-xs text-muted">{site.id}</span>
              </a>
            </li>
          ))}
        </ul>
        {sites.data?.items.length === 0 && <p className="text-muted">No sites yet.</p>}
      </main>
    </div>
  );
}
