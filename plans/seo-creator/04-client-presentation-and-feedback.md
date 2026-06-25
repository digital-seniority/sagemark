# Client Presentation & On-Screen Feedback

The SEO Creator's binding constraint is not generation — it is **release**. The content-flywheel bible names approval, not drafting, as the bottleneck (agentic approval cycle ~1.8 days median vs ~4.7 manual), and "we can't prove it" / slow sign-off as the two top churn drivers. So the client surface is not a nicety bolted onto the operator tool; it is the place where the asset converts from *eligible* to *released*. This document specifies that surface: how the client sees the hub, how they leave feedback on the page itself, how a "Request changes" comment becomes an agent edit, how versions and sign-off work, and exactly what to build for MVP vs later.

The governing principle: **the client tunes soft surface; hard gates stay non-overridable canon.** A client can pin a comment, approve a section, or ask for a softer intro — they can never approve a piece past a Stage-A veto (UNSOURCED_STAT, YMYL_NO_BYLINE, THIN_CONTENT, faithfulness failure). For Whispering Willows (memory care, squarely YMYL) this is not optional.

---

## 1. The two surfaces are separate by construction

The operator surface (the three-zone agent canvas: Agent | piece preview | Inspector/gate scorecard, documented in `01-…` / `02-…`) and the client surface are deliberately different objects. They differ in what they expose, who they authenticate, and what a click does.

| | Operator surface (`apps/seo`, authed) | Client surface (tokenized review link) |
|---|---|---|
| Auth | `getCurrentUser` + `getCurrentWorkspace` | Opaque review token → exactly one `(client_id, piece_id, version)` |
| Sees the gate scorecard | Yes — full Stage-A vetoes + Stage-B 8-dim bars | No (optionally: a curated "Reviewed & graded" trust strip for premium clients) |
| Sees credits / Improve-Draft / raw markdown export | Yes | **Never** |
| Streaming agent thinking | Yes (real token deltas) | No — sees a finished, SSR-rendered page |
| Edits | Direct markdown edit while `status='draft'` | Pinned comments + section Approve/Request-changes only |
| What it renders | Side-panel markdown editor toggling to SSR preview | The **actual** SSR page (`/clients/[client]/blog/[slug]`), full body in initial HTML, FAQPage JSON-LD |

**Rationale.** The client must judge the page exactly as Google, readers, and AI answer crawlers (GPTBot, ClaudeBot, PerplexityBot — which largely don't run JS) will see it. The only honest preview is the real server-rendered route, not a markdown blob or a PDF. The gate scorecard is an *internal trust signal*; exposing the raw 8-dimension breakdown to a client invites them to argue with the math instead of the prose. **Alternative considered:** a single shared canvas with a "client mode" flag. Rejected — flag-gated UIs leak (one missed conditional shows a client the credit ledger or another tenant's data), and the client review token must be a *hard* fail-closed boundary, not a render-time `if`.

---

## 2. How the client is presented the artifact

### 2.1 Shareable live preview link (the primary surface)

The deliverable is a tokenized, workspace-scoped **hosted live preview** of the rendered hub — not a deploy-per-client, not a PDF.

- **What it renders.** The same SSR route the public will eventually get: `/clients/[client]/blog/[slug]` for each piece, plus the resource-library **homepage** (hero, statistic callout, named three-stage cluster section, guide-card grid, quality section, tour CTA + DSHS license badge). The homepage is the net-new per-client hub template fed by the cluster map (see `03-…` render doc). The client navigates the *hub*, not a single article — pillar → spokes via real internal links, exactly as a reader would.
- **The token.** A row-level review token resolves to exactly one `(workspace_id, client_id, piece_id, version)` tuple (or one cluster snapshot for a hub-level review). It widens nothing. RLS stays fail-closed: the token grants read of one tenant's one version and the assets it references — never another client's corpus, never another version's body. **This is the agency-ending bug the judge prompt flags #1; the review link is the most likely place to leak it.**
- **Same-origin sandboxed iframe.** The page renders inside a `sandbox`ed same-origin iframe so the pin/comment overlay (Section 3) can anchor to real page elements via `postMessage`, reusing `useIframePinDrop` (strict origin + source-window + finite-coord validation; verified at `apps/agents/src/components/videogen/canvas/hooks/useIframePinDrop.ts`).
- **Paired SERP-snippet preview.** Alongside the live page, show the existing `SerpPreview` mock (`apps/agents/src/app/content/new/SerpPreview.tsx` — CSS-only Google snippet with char-count badges at SERP limits) so the client also sees the *search-result* appearance, not just the on-page rendering. This is the existing "how it looks in search" primitive — reuse, don't rebuild.

**Alternative considered: Vercel toolbar threads on a per-branch deploy.** The toolbar gives element-anchored comments + reply + resolve for free (MCP: `list_toolbar_threads`, `get_toolbar_thread`, `reply_to_toolbar_thread`, `change_toolbar_thread_resolve_status`). Rejected as the *primary* surface because it ties every client review to a Vercel deployment per client/version and pulls review *out* of the multi-tenant Supabase model where tenancy, versioning, and the gate already live. We mirror its **interaction vocabulary** (thread = pinned location + messages + open/resolved status) inside our own data model instead — inheriting the familiar UX without the deploy-coupling.

### 2.2 Presentation mode (premium, the on-screen moment)

For a live pitch or QBR, the operator can flip the same shared link into **Presentation mode**: a full-bleed rendering of the hub homepage and pillar with operator-only chrome hidden, a "Reviewed & graded" trust strip (named accountable byline, source-grounding to named authorities — Alzheimer's Association, NIA — medical disclaimer, the DSHS license badge), and a one-click walk of the three funnel stages (Awareness → Consideration → Decision). The trust strip is the *only* place gate output surfaces to a client, and it is curated copy ("Every figure traces to a named authority"), not raw dimension scores.

### 2.3 Branding

The client view carries the *client's* brand, not Sagemark's: the hub is the client's content asset. Branding is data on `content_clients` + `voice_specs` (logo/asset references, palette), already per-tenant. The Sagemark wrapper around the iframe (the comment rail, version switcher) uses the existing `apps/agents` visual convention — Tailwind v4 foreground/background tokens, `font-mono` eyebrow + `font-display` headings, the emerald/blue/amber/red verdict palette where any status is shown — so the agency chrome is consistent while the *content* is the client's.

---

## 3. On-screen feedback mechanisms

Feedback happens **on the rendered page**, at two granularities, both reusing verified videogen primitives. The only net-new code is an SEO-page comment-thread data model; the interaction layer is copy-and-adapt.

### 3.1 Element-anchored inline comments (Vercel-toolbar style)

- **Interaction.** `PreviewClickHandler` (verified at `apps/agents/src/components/videogen/canvas/PreviewClickHandler.tsx`) provides the documented pause-then-pin state machine: first click pauses/selects, second click drops a pin at normalized `[0,1]` coords via `getBoundingClientRect()`, keyboard-accessible (`role="button"`, Enter/Space drop a center pin, Esc clears via parent). It already clamps coords and degrades to a center pin on degenerate layout. For a static article there is no "playback" to pause, so the first-click semantics become "arm comment mode," but the layer ports unchanged.
- **Marker.** `PinOverlay` renders the anchored marker (dot + connector + callout, normalized coords, `pointer-events:none` so it never blocks clicks, `role="img"` with `aria-label`). Aspect-ratio/resize stable.
- **Cross-iframe anchoring.** `useIframePinDrop` lets the iframe post `{x, y, docWidth, docHeight, elementHint}` and the parent validates + normalizes — so a comment anchors to an *actual page element* (selector / `data-key`), not a pixel.
- **Thread model (net-new, mirror the Vercel shape).** Each pin carries a thread: `{pinned_location, elementHint, messages[], status: open|resolved, version_left_on, author}`. Reply + resolve/unresolve semantics mirror the toolbar so the interaction is familiar. Persist `workspace_id`/`client_id` on every row; RLS fail-closed.

### 3.2 Section-level Approve / Request-changes

On each H2 block, a verb pill: **Approve** / **Request changes**. Reuse `ApprovalBeat`'s visual language (verified at `apps/site/src/components/demos/research/ApprovalBeat.tsx`): the pulsing status pill + primary/secondary buttons (`approval.pill`, primary auto-flash on approve). This lets a client sign off the page **piecemeal** — approve sections 01 and 02, request changes on the "Paying for Memory Care" section — which maps cleanly onto the bible's per-section release thinking and produces a precise, auditable record of what was and wasn't accepted.

### 3.3 Inline edit suggestions

A lighter-weight third verb on a text selection: **Suggest edit** — the client highlights a phrase and types a replacement ("change 'patients' to 'residents'"). This becomes a *typed instruction with an explicit anchor*, which routes into the agent loop (Section 4) as a tightly-scoped edit rather than a free-form comment. Defer to a later phase if MVP scope is tight — pinned comments + section verbs already cover the requirement; inline suggestions are a polish multiplier.

---

## 4. How feedback loops back into the agent to fine-tune

A "Request changes" comment or a "Suggest edit" is not an email — it is **an agent instruction that becomes an auditable, reversible version.** This is the SEO analog of `POST /videogen/api/chat-edit` (verified at `apps/agents/src/app/videogen/api/chat-edit/route.ts`), adapted from video scene-spec diffs to markdown-section diffs.

### 4.1 The flow

```
client comment / suggest-edit on the hosted preview
        │  (comment text + elementHint/section anchor)
        ▼
operator triages → routes into agent chat-edit loop  ← human stays in the loop
        │
        ▼  POST /clients/api/chat-edit  (SEO-specific constrained-edit contract)
agent emits a BOUNDED body diff (region + instruction → markdown-region diff)
        │
        ▼  HOST applies diff → new content_piece_versions snapshot (auto=true)
        │
        ▼  HOST RE-RUNS THE FULL GATE  (Stage-A vetoes → Stage-B composite)
        │
        ▼  SSE one-line "what changed" summary streams to the activity feed
        ▼  comment thread updates: "addressed in v4 — see diff"
```

### 4.2 What ports verbatim from chat-edit

The route's hardening is the spec, not a suggestion (these are production bug-fix scars worth preserving):

- **Stale-edit guard → 409.** Client sends SHA-256 of the current body; server recomputes and compares constant-time. Mismatch ⇒ 409 `stale-edit`, client refreshes. (An edit must not silently apply to a body the client wasn't looking at.)
- **Per-tenant rate limit → 429.** Count auto-versions for the piece in the last hour (videogen uses 30/hr); over the cap ⇒ 429.
- **Workspace ownership → 403.** Re-fetch the row `.eq("workspace_id", workspace.id)` *before* anything else.
- **No-LLM-key → 503** `no-llm-key`.
- **PII discipline.** Never log instruction text, LLM prose, or body. Log ids + counts + wall-clock only.

### 4.3 What is net-new

The videogen diff shape (`{op:'update', changes:{props}}` over a `SceneSpec`) does **not** generalize to markdown. Build an SEO-specific constrained-edit contract: `{region/section anchor, instruction} → bounded markdown body diff`. The agent is constrained to edit the targeted region, emit a summary, and nothing else — it cannot rewrite the whole piece off one comment.

### 4.4 The non-negotiable invariant: the gate re-runs, in host code, every time

Every accepted edit re-enters the FSM and **re-runs the full non-compensatory gate in host code outside the agent loop.** A fine-tune that breaks faithfulness, trips THIN_CONTENT, or relaxes the YMYL byline requirement **cannot advance toward publish** — the agent gets a read-only `runGate` tool, never a path past a veto. This is the failure mode the bibles warn about most loudly: a persuasive client instruction ("just make it punchier, drop the citations") must not be able to talk the LLM past a YMYL/faithfulness veto. **Client approval is advisory on hard gates; the credentialed reviewer holds release.** The N=3 audit→revise cap and the "forced to human review" hold-state apply here exactly as in the audit route.

---

## 5. Version compare (before/after) and sign-off

Versions and sign-off are the **same object**, reusing `VersionHub` + `VersionDiff` semantics.

- **Every accepted edit = an auto-version** (`content_piece_versions` append-only snapshot: `{piece_id, client_id, version, body, dimensions, verdict, snapshot_at}`, written *before* every forward move). The client-facing before/after is `VersionDiff` against the prior version — "here's what changed since your last review" is one click.
- **Sign-off = a NAMED, undeletable version** ("Approved v4 — 2026-06-25") that records **approver identity**. Named versions cannot be deleted (the API defends this with a 409, mirroring videogen). The recorded approver supplies the E-E-A-T accountability trail; for YMYL the approving reviewer's credential feeds the "Reviewed by [Name, Credential]" byline.
- **Auto vs named invariant.** Auto-versions are the working history; a named version is a protected bookmark = a release decision. This is exactly the videogen Version Hub contract, reused.

**Sign-off is fail-closed and tiered** (per the bible's release matrix, see `02-…` lifecycle doc): routine refresh of an already-released template can show "auto-approved (logged)"; **first publication and any YMYL/entity page require an explicit human Approve gate routed to the right tier** (named editor for first publication; credentialed reviewer for YMYL). A client "Approve" on a YMYL piece is captured as *client sign-off* but does not itself release — `canPublish()` still requires the recorded credentialed human release. Never let a client approval bypass a hard gate.

---

## 6. Notifications

Notifications exist to attack **approval debt** — the metric the bible names as the binding constraint.

| Event | Recipient | Channel |
|---|---|---|
| Review link sent / opened | Operator | In-app activity feed |
| Client left a comment / requested changes | Operator (account lead) | In-app + optional email digest |
| Agent applied an edit, gate re-ran, verdict changed | Operator | Activity feed (one-line "what changed" summary) |
| Section approved / piece signed off | Operator + reviewer | In-app |
| Open thread aging past SLA ("approval debt") | Account lead | Daily digest |

**Instrument approval-cycle time per client as a first-class KPI** (time from link-sent → sign-off, plus open-thread count). The review surface defaults to showing *unresolved* threads first (mirroring `list_toolbar_threads`' unresolved default). MVP can ship with in-app feed only; email/Slack digests and the cron-driven approval-debt aging alert are a fast-follow.

---

## 7. Permissions (internal vs client view)

| Capability | Operator (authed) | Client (token) | Credentialed reviewer |
|---|---|---|---|
| See full gate scorecard | ✅ | ❌ | ✅ |
| See credits / cost / model | ✅ | ❌ | ❌ |
| Edit body directly (draft) | ✅ | ❌ | ❌ |
| Pin comments / section verbs / suggest edits | ✅ | ✅ | ✅ |
| Route a comment into the agent edit loop | ✅ | ❌ (operator triages) | ❌ |
| Approve a section (advisory) | ✅ | ✅ | ✅ |
| **Release a YMYL piece** | ❌ | ❌ | ✅ (recorded sign-off) |
| Cross-tenant / cross-version read | ❌ | ❌ (token scoped to one) | ❌ |

The token-only client has **no verified identity** — adequate for advisory comments and non-YMYL section approval, but **insufficient for a YMYL sign-off byline**, which needs a credentialed, attributable approver. That gap is closed by routing YMYL release to the credentialed reviewer, not the token client. Tenancy is enforced the way `chat-edit` and `VersionHub` already enforce it: `workspace_id`/`client_id` on every row, RLS fail-closed, review token scoped to exactly one piece/version.

---

## 8. MVP vs Later

### Build for MVP (Phase 3 — render + hub + client review)

1. **Tokenized hosted live preview** of the real SSR hub (homepage + pieces), full-body HTML, FAQ JSON-LD, paired `SerpPreview`. Token scoped to one `(client, piece, version)`, RLS fail-closed.
2. **Element-anchored pinned comments** — port `PreviewClickHandler` + `PinOverlay` + `useIframePinDrop`; build the comment-thread data model (pin + messages + open/resolved + version-left-on).
3. **Section-level Approve / Request-changes** — reuse `ApprovalBeat` visuals.
4. **Comment → agent edit loop** — the SEO `chat-edit` analog (markdown-region diff) with the full chat-edit hardening (409 stale-edit, 429 rate-limit, 403 ownership, 503 no-key, PII discipline) and **the gate re-running in host code on every edit.**
5. **Version compare + named sign-off** — reuse `VersionHub`/`VersionDiff`; named version records approver identity; YMYL release held by the credentialed reviewer.
6. **Approval-cycle-time + open-thread KPI** instrumented per client (in-app feed sufficient).

### Later (Phase 4+ / deferrable)

- **Inline edit suggestions** (selection → replacement → scoped agent edit).
- **Presentation mode** full-bleed + "Reviewed & graded" trust strip.
- **Email/Slack notification digests** and the cron-driven approval-debt aging alert.
- **Pin re-anchoring across versions** — a comment pinned to a section in v2 may not map after the agent rewrites that section in v3. Persist `elementHint`/`data-key` and re-anchor-on-diff so threads don't orphan. (Defer, but design the thread schema to carry the anchor now.)
- **PDF/print leave-behind** (e.g. the printable "12-Question Tour Checklist") as a *secondary* export — never the review surface.
- **Client self-serve login / RLS membership model** — explicit v1 non-goal; only needed if clients review without an operator. Nothing to mirror from videogen; design fresh when demanded.

---

## 9. The two rules that keep this surface on-thesis

1. **Client feedback is soft; hard gates are canon.** A pinned comment, a section approval, a "make it warmer" instruction — all route through the agent and re-enter the gate. None can push a piece past a Stage-A veto or relax the YMYL byline/credential/citation requirement. The credentialed reviewer, not the client and not the agent, holds release.
2. **The review token is a fail-closed tenancy boundary, not a render flag.** It grants read of exactly one tenant's one version. It widens no retrieval, exposes no other version, and surfaces no operator chrome. Cross-tenant leakage via the review link is the agency-ending bug — the token is scoped at the row, enforced by RLS, and never trusted to a client-side conditional.
