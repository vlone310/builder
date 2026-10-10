import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { Api, WebhookDelivery } from "../lib/api";
import { Button, Input, Label } from "../ui";
import { useAsync } from "./useAsync";

const STATUS_STYLE: Record<WebhookDelivery["status"], string> = {
  succeeded: "text-green-700",
  pending: "text-warn",
  failed: "text-danger",
};

/** Where publishes are announced. The host verifies each delivery with the secret. */
export function WebhooksPanel({ api, siteId }: { api: Api; siteId: string }) {
  const webhooks = useAsync(async () => {
    const { items } = await api.webhooks(siteId);
    return Promise.all(
      items.map(async (webhook) => ({
        ...webhook,
        deliveries: (await api.webhookDeliveries(webhook.id)).items.slice(0, 5),
      })),
    );
  }, [api, siteId]);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.createWebhook(siteId, url);
      setSecret(created.secret);
      setUrl("");
      webhooks.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-semibold">Publish webhooks</h2>
      <p className="mb-3 text-xs text-muted">
        Each publish sends a signed POST to these URLs so the host app refreshes the page at once.
      </p>
      {secret && (
        <div
          role="status"
          className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          Signing secret (shown once). Set it as <code>BUILDER_WEBHOOK_SECRET</code> in the host
          app:
          <code className="mt-1 block break-all font-mono">{secret}</code>
        </div>
      )}
      <ul className="mb-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
        {webhooks.data?.map((webhook) => (
          <li key={webhook.id} className="p-3">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-xs">{webhook.url}</span>
              <span className="text-[11px] text-muted">{webhook.events.join(", ")}</span>
              <Button
                size="icon"
                variant="danger"
                className="ml-auto"
                aria-label={`Delete webhook ${webhook.url}`}
                onClick={async () => {
                  await api.deleteWebhook(webhook.id);
                  webhooks.reload();
                }}
              >
                <Trash2 size={13} />
              </Button>
            </div>
            {webhook.deliveries.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px]">
                {webhook.deliveries.map((delivery) => (
                  <li key={delivery.id} className="flex gap-2">
                    <span className={STATUS_STYLE[delivery.status]}>{delivery.status}</span>
                    <span>{delivery.payload.type}</span>
                    <span className="text-muted">
                      {delivery.payload.page?.slug ?? delivery.payload.page?.name}
                    </span>
                    <span className="ml-auto text-muted">
                      {delivery.lastStatusCode ?? delivery.lastError ?? ""} ·{" "}
                      {new Date(delivery.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {webhooks.data?.length === 0 && (
          <li className="p-3 text-xs text-muted">No webhooks yet.</li>
        )}
      </ul>
      <form onSubmit={add} className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="webhook-url">Endpoint URL</Label>
          <Input
            id="webhook-url"
            placeholder="https://www.example.com/api/builder/revalidate"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>
        <Button type="submit">Add webhook</Button>
      </form>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </section>
  );
}
