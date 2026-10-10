# Pilot deployment

Phase 3's gate is a first pilot tenant serving live pages. Every piece runs in Kubernetes, with
secrets in Vault (synced by External Secrets Operator), sign-in through Keycloak, and Cloudflare
in front of the Delivery API. [kubernetes.md](kubernetes.md) is the contract for each image;
this runbook is the order of work and the gate checklist.

`<domain>` stands for the dedicated domain, which is not chosen yet.

## What runs where

| Piece | Runs as | Public URL |
| --- | --- | --- |
| Postgres 16 | Managed or in-cluster Postgres; databases `builder` and `keycloak` | none |
| Keycloak | `infra/keycloak/Dockerfile` | `https://auth.<domain>` |
| Content API | `Dockerfile`, `SERVICE=content-api` | `https://content.<domain>` |
| Delivery API | `Dockerfile`, `SERVICE=delivery-api`, behind Cloudflare | `https://delivery.<domain>` |
| Worker | `Dockerfile`, `SERVICE=worker`, one or more replicas | none |
| Editor | `apps/editor/Dockerfile` | `https://editor.<domain>` |
| Pilot host | `apps/sample-host/Dockerfile` | `https://pilot.<domain>` |

## Steps

1. **Postgres.** Create the `builder` database with a user that owns its tables, and a
   `keycloak` database and user.
2. **Vault.** Write the paths in the [secrets table](kubernetes.md#configuration-and-secrets) at
   `secret/builder/<deployable>`, and add one ExternalSecret per path.
3. **Keycloak.** Deploy with `KC_HOSTNAME=https://auth.<domain>`,
   `BUILDER_EDITOR_URL=https://editor.<domain>` and the SMTP settings. Check that the `builder`
   realm exists and that its email settings send (Realm settings → Email → Test connection).
4. **Migrations.** Run `node dist/migrate.js` from the Content API image as a Job.
5. **Platform.** Deploy the Content API, Delivery API, worker and editor with the settings in
   kubernetes.md, and the ingress hosts.
6. **Cloudflare.** Proxy `delivery.<domain>`, add a Cache Rule (eligible for cache, Edge TTL from
   the `Cache-Control` header), and give the worker a token with Cache Purge on the zone. Every
   Delivery API URL carries the site id, so cache entries never mix sites.
7. **Tenant data.** From a checkout, with `DATABASE_URL` pointing at the `builder` database:

   ```sh
   pnpm --filter @builder/db bootstrap --org "Pilot" --site "pilot.<domain>" \
     --host-url https://pilot.<domain> --env prod \
     --admin-email <first admin's email> --editor-url https://editor.<domain>
   ```

   Put the printed delivery key and webhook secret in Vault at `secret/builder/sample-host`. Send
   the admin their invite link, which is valid for 7 days: they create a Keycloak account with that
   email (or sign in), join the org, and invite everyone else from Members.
8. **Pilot host.** Deploy the sample host with the bootstrap's site id and environment.

## Gate checklist

Sign-in:

- [ ] The bootstrap invite link leads the first admin through Keycloak registration (email
      verified) into the org.
- [ ] An invite from Members arrives by email; the invitee joins with the invited role.
- [ ] Someone with a Keycloak account but no invite sees "No access yet".
- [ ] `POST https://content.<domain>/auth/dev-login` returns 404.

Publishing:

- [ ] `https://pilot.<domain>/` returns 404 before any page is published.
- [ ] In the editor, create the home page, drag in components, publish.
- [ ] The live page shows the change within seconds, without a redeploy. The worker log shows a
      succeeded webhook, as does the webhook's delivery log in site settings.
- [ ] A preview link opens the draft for someone signed out; the live page stays unchanged.
- [ ] Revoking the link makes it fail.
- [ ] `Cache-Tag` on Delivery API responses; `cf-cache-status: HIT` on repeats, `MISS` after a
      publish.

## Rehearsed locally

`pnpm local:up --app` runs the same images against local Postgres, Keycloak, Vault and Mailpit
([local-environment.md](local-environment.md)). The e2e suite covers the sign-in and publishing
checks above, except Cloudflare and real email delivery.

## Still open

- The domain's name.
- The cluster, the Vault and ESO setup in it, the Postgres offering, and the image registry.
- Who owns the Cloudflare zone and the SMTP account.
