# SEO Creator — go-live checklist (the activation flip)

Everything is staged + INERT on `preview` (Run #23 + the SoM/activation follow-up). Merging changed NOTHING live. Going live is the deliberate steps below — all in James's hands. Each is reversible (unset the env / revert).

## A. Deploy env vars (set on the Vercel project `digital-seniority/sagemark-seo`)
| Var | Purpose | Effect when set |
|---|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | host-side service-role DB access | the live `ContentDataAccess` / review / SoM-store adapters activate (RLS bypassed → the app's explicit `workspace_id`/`client_id` filters are the boundary). *(Service-role key was already set on the deploy per the Stage-A note — confirm it's the one `readReadAdapterCreds()` reads.)* |
| `AI_GATEWAY_API_KEY` (or Vercel OIDC) | metered AI Gateway | the SoM direct-runner can call ChatGPT/Claude/Gemini (Gateway-only, DR-013) |
| `SOM_LIVE=1` | the share-of-model crons | the weekly ingest cron starts probing + writing `share_of_model` rows (**incurs per-run token cost**) |
| `PUBLISH_ENABLED=1` (a.k.a. `CONTENT_PUBLISH_ENABLED`) | the publish gate | non-YMYL content can publish (YMYL still blocked until B below) |
| `PILOT` | NON-production only | in production this is **ignored** (`pilot` is always false in prod, DR-037) — only set it in preview/staging for pilot testing |

## B. Human prerequisites BEFORE real YMYL publishing (DR-037 — the hard line)
1. **Provision a pilot workspace** in Supabase: a `content_clients` row for Whispering Willows of Mount Vernon (+ its `workspace_id`, an author entry).
2. **Seat a REAL credentialed reviewer** — replace the placeholder: insert a real `byline_authorizations` row (real name + verifiable credential + `authorized_by` + `scope`), NOT the `placeholder:true` seed. Until this exists, the code refuses every YMYL release in production (`pilot:false` ⇒ `placeholder-in-production`), so YMYL stays unpublished even with `PUBLISH_ENABLED=1`. **This is the safety line — do not seat the placeholder as the real authority.**
3. Apply the pilot reviewer seed ONLY in the pilot workspace if you still want the placeholder for non-publishing testing.

## C. Then the live pipeline turns on, per channel
- **Data layer:** live reads/writes for content + review (token boundary fail-closed).
- **SoM (hybrid, DR-038):** Claude = real citations (web-search), ChatGPT/Gemini = labeled proxy, GEO-tracker vendor = later upgrade (seam ready). Rows are `source_channel`-labeled so proxy is never reported as a citation.
- **Publish:** non-YMYL on `PUBLISH_ENABLED`; YMYL only once B.2 is real.

## D. Still deferred (not blocking the above)
- **Freshness cron** stays inert until the read-adapter surfaces the internal `content_pieces.id` (a slug-as-id transition was correctly refused). SoM **ingest** is fully wired.
- **GEO-tracker vendor** (Profound/AthenaHQ/Peec, ~$99–399/mo) — the real ChatGPT/AIO citation upgrade; the `vendor` adapter seam is pre-wired.
- **Live-Sandbox worker (Stage B/C)** — the autonomous-drafting worker deploy: needs the bridge-JWT secret on host+worker, the worker Gateway cred, and the Sandbox wiring.
- **P1.C.4 DoD** closes once real (labeled) `share_of_model` rows land from A+B above (mocks don't count, per the spec).

## Recommended order
B.1 (pilot workspace) → A (`SUPABASE_*`, `AI_GATEWAY_API_KEY`) → `SOM_LIVE=1` (start the north-star feed; cheap, no publishing) → verify real SoM rows land (closes P1.C.4 DoD for the covered engines) → B.2 (real reviewer) → `PUBLISH_ENABLED=1` (YMYL now legitimately publishable). Reverse any step by unsetting its env.

---

## P1.C.4 DoD close — the exact steps to turn the live-smoke into persisted rows
The path is proven (`som-live-smoke-evidence.md`). To close the formal DoD (real labeled `share_of_model` rows for a provisioned client), run the cron **in the app's real runtime** (the smoke can't write rows — no client + standalone can't resolve the workspace modules). Pick local-dev OR deploy.

**Prereqs (both paths):**
1. **Provision a real pilot client** (Supabase SQL editor) — use a REAL workspace_id if you have one, else a generated one for the pilot:
   ```sql
   insert into public.content_clients (name, blog_slug, workspace_id)
   values ('Whispering Willows of Mount Vernon','whispering-willows', gen_random_uuid())
   on conflict (blog_slug) do nothing
   returning id, workspace_id;
   ```
2. Env present: `SUPABASE_URL`(or `NEXT_PUBLIC_SUPABASE_URL`) + `SUPABASE_SERVICE_ROLE_KEY` + `AI_GATEWAY_API_KEY` + `SOM_LIVE=1` + `CRON_SECRET`.

**Path A — local dev runtime:**
```
cd apps/seo && pnpm install && pnpm dev    # boots Next with proper workspace resolution
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/ingest-share-of-model
```
**Path B — Vercel deploy:** ensure the activation code is deployed; set the env above on the `sagemark-seo` project; then
```
curl -H "Authorization: Bearer $CRON_SECRET" https://<deploy-url>/api/cron/ingest-share-of-model
```
(or let the weekly schedule fire.)

**Verify (read-only — Claude can run this):**
```sql
select engine, source_channel, count(*) n, sum((cited)::int) cited
from public.share_of_model group by 1,2 order by 1,2;
```
Expect rows with `source_channel` ∈ {`direct-citation` (Claude), `direct-proxy` (ChatGPT/Gemini)} — `direct-citation` carries the real discovery citations; `direct-proxy` is reported separately (never summed as a citation). **When these rows exist, P1.C.4 is DoD-complete** for the covered engines (the GEO-tracker vendor upgrades the proxy engines later).

Expected live pattern (from the smoke): Claude cites for discovery queries; the proxy engines only echo the brand when it's named — so a low `direct-proxy` cited-rate on discovery queries is correct, not a bug.
