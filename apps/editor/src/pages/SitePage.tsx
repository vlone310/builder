import { FileText, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { navigate } from "../lib/router";
import { useApi } from "../lib/session";
import { Button, Dialog, Input, Label, Select } from "../ui";
import { AppHeader } from "./AppHeader";
import { useAsync } from "./useAsync";
import { WebhooksPanel } from "./WebhooksPanel";

export function SitePage({ siteId }: { siteId: string }) {
  const { api, can } = useApi();
  const data = useAsync(async () => {
    const [site, environments, pages] = await Promise.all([
      api.site(siteId),
      api.environments(siteId),
      api.pages(siteId),
    ]);
    return { site, environments: environments.items, pages: pages.items };
  }, [api, siteId]);
  const [envId, setEnvId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const environment =
    data.data?.environments.find((e) => e.id === envId) ?? data.data?.environments[0];
  const canEdit = can("content.edit");

  const open = (pageId: string) =>
    navigate(`/pages/${pageId}${environment ? `?env=${environment.id}` : ""}`);

  return (
    <div className="min-h-full">
      <AppHeader>
        <span className="text-muted">/</span>
        <span>{data.data?.site.name ?? siteId}</span>
      </AppHeader>
      <main className="mx-auto max-w-4xl p-4 sm:p-8">
        {data.error && <p className="text-danger">{data.error.message}</p>}
        {data.data && (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <h1 className="mr-auto text-lg font-semibold">Pages</h1>
              <div className="w-48">
                <Label htmlFor="env">Preview environment</Label>
                <Select
                  id="env"
                  value={environment?.id}
                  onValueChange={setEnvId}
                  placeholder="No environments"
                  options={data.data.environments.map((e) => ({
                    value: e.id,
                    label: `${e.name} · ${new URL(e.hostUrl).host}`,
                  }))}
                />
              </div>
              {canEdit && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={14} /> New page
                </Button>
              )}
            </div>
            {!environment && (
              <p className="mb-4 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
                Add an environment (the host app's URL) to edit pages visually.
              </p>
            )}
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
              {data.data.pages.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    disabled={!environment}
                    onClick={() => open(page.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 disabled:cursor-not-allowed"
                  >
                    <FileText size={15} className="text-muted" />
                    <span className="font-medium">
                      {page.kind === "page" ? page.slug : page.name}
                    </span>
                    <span className="text-xs text-muted">{page.locale}</span>
                    {page.lock && (
                      <span className="text-xs text-warn">Editing: {page.lock.holder}</span>
                    )}
                    <span
                      className={`ml-auto text-xs ${page.publishedRevisionId ? "text-green-700" : "text-muted"}`}
                    >
                      {page.publishedRevisionId ? "Published" : "Draft"}
                    </span>
                  </button>
                </li>
              ))}
              {data.data.pages.length === 0 && <li className="p-4 text-muted">No pages yet.</li>}
            </ul>
            {can("site.configure") && <WebhooksPanel api={api} siteId={siteId} />}
          </>
        )}
      </main>
      {data.data && (
        <NewPageDialog
          open={creating}
          onOpenChange={setCreating}
          defaultLocale={data.data.site.defaultLocale}
          onCreate={async (slug, locale) => {
            const { page } = await api.createPage(siteId, { kind: "page", slug, locale });
            open(page.id);
          }}
        />
      )}
    </div>
  );
}

function NewPageDialog({
  open,
  onOpenChange,
  defaultLocale,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultLocale: string;
  onCreate: (slug: string, locale: string) => Promise<void>;
}) {
  const [slug, setSlug] = useState("/");
  const [locale, setLocale] = useState(defaultLocale);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onCreate(slug, locale);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New page">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="slug">URL path</Label>
          <Input
            id="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="/promotions/summer"
            required
          />
        </div>
        <div>
          <Label htmlFor="locale">Locale</Label>
          <Input id="locale" value={locale} onChange={(e) => setLocale(e.target.value)} required />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary">
            Create and edit
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
