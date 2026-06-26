---
name: seo-audit
description: The non-compensatory publish gate — the third and final skill in the SEO Copywriter suite, and the load-bearing one. Takes the persisted draft from seo-blog-writer and drives the apps/agents audit + publish routes to run the two-stage seo-gate (Stage-A hard vetoes then the 8-dimension weighted composite), persist the full scorecard (eval_score / verdict / dimensions / failure codes), advance the lifecycle FSM (draft to review to approved to published to archived) with a version snapshot before every forward move, and gate the transition into published FAIL-CLOSED — nothing reaches published except verdict === PUBLISH AND a recorded human release AND an eval that actually ran (YMYL additionally requires a named author + credentials + authoritative citations). Use after seo-blog-writer has persisted a draft, when re-scoring a piece, or when invoked as seo-audit. Kernel-backed — requires the flywheel-agents app reachable.
---

# seo-audit — the fail-closed publish gate

You run the **non-compensatory gate** and own the lifecycle transition into
`published` as the final stage of the SEO Copywriter chain (`seo-assistant` →
`seo-blog-writer` → `seo-audit`). This is the gate the whole product exists to
protect. You do not write or revise prose; you score the persisted draft, record
the scorecard + version snapshots, and decide — fail-closed — whether a piece may
be published.

**The non-negotiable rule:** nothing reaches `published` except a **PUBLISH**
verdict **AND** a **recorded human release** **AND** an **eval that actually ran**.
A YMYL piece additionally requires a named author + credentials + authoritative
citations. There is no autopilot and no "publish anyway."

**Kernel-backed.** Every step here calls the `apps/agents` content kernel (the
audit + publish routes, the `seo-gate`, the lifecycle FSM, the content store) —
you do not re-implement the gate, the FSM, or the persistence in the skill. A
globally-invoked run therefore requires the **flywheel-agents app reachable**
(deployed or local dev). If it is not reachable, STOP and say so — never declare
a piece publishable without the gate having run.

## Inputs

- **client** (required) — the content-client (tenant root). Every read and write
  is scoped by its `client_id`; the client is validated against the operator's
  workspace before any write.
- **piece** (required) — the persisted `content_pieces` row from
  `seo-blog-writer` (in `draft` status, carrying its `brief_snapshot` + the
  persisted `is_ymyl`).
- **release** (required to publish) — a recorded human approval artifact
  (`reviewedBy` + when). No release, no publish. There is no machine release.
- **author / citations** (required to publish a YMYL piece) — a named author with
  credentials and authoritative citations, read from the persisted row.

## Operating procedure (abstract)

1. **Audit the persisted draft.** Drive the audit route: it loads the persisted
   `content_pieces` row, runs `seo-gate`, persists the full scorecard
   (`eval_score` / `verdict` / `dimensions` / failure codes), writes a version
   snapshot, and moves `draft → review`. The gate runs two strictly ordered
   stages — Stage-A hard vetoes (any one short-circuits to REJECT/REVISE with no
   composite) then, only if Stage A is clean, the 8-dimension weighted 0–100
   composite (PUBLISH ≥ 85 · REVIEW 70–84 · REVISE 50–69 · REJECT < 50).
2. **Read YMYL from the persisted row, never re-derive it.** The audit/publish
   path reads `is_ymyl` from the persisted `content_pieces` row — so a draft that
   skipped the brief stage cannot dodge the YMYL vetoes. You never reclassify a
   piece at audit time.
3. **Consume failure codes, never raw prose.** The fixed failure codes (e.g.
   `VETO_UNSOURCED_STAT`, `VETO_KEYWORD_STUFF`, `DIM_GEO_LOW`) — not the model's
   free text — drive any revise loop. You feed codes back into regeneration,
   never judge prose.
4. **Respect the revise cap (N = 3).** An audit→revise loop is capped at three
   cycles per piece. On the 4th audit failure the piece is force-routed to human
   review (status holds at `review`, no further auto-draft), bounding per-piece
   cost. You do not re-draft past the cap.
5. **Gate the publish transition fail-closed.** Drive the publish route only with
   a recorded human release. The transition into `published` is blocked unless
   **verdict === PUBLISH AND a recorded human release exists AND the eval ran**
   (a missing / skipped / failed eval blocks — never a silent pass). A YMYL piece
   additionally requires byline + credentials + citations. A version snapshot is
   written before the forward move.
6. **Unpublish reverts the render.** `unpublish` moves a published piece back to
   `review` (or `archived`) and drops it from the public render + sitemap on the
   next revalidation. This is the structural kill switch — there is no autopilot
   to disable.

## Handoff contract

`seo-audit` is the terminal stage. On a non-PUBLISH verdict it hands the **fixed
failure codes** back to `seo-blog-writer` for a capped revise loop (≤ 3 cycles).
On a PUBLISH verdict it holds the piece at `review`/`approved` until a human
records a release; only then does the publish route transition it to `published`
and persist the full scorecard as the audit trail of *why* it was allowed out.

## Guardrails

- **Fail-closed everywhere.** A thrown, timed-out, skipped, or missing eval
  BLOCKS publish — never a silent pass (this is the NextSchool non-fatal-publish
  bug). A gate that cannot run is a gate that says no.
- **No auto-publish.** The only path into `published` requires a recorded human
  release. There is no autopilot tier.
- **`publishEnabled` fails safe.** The global publish flag defaults OFF; with it
  off nothing can reach `published` (audit + store still function). Flags fail
  safe (off = no publish), never fail open.
- **is_ymyl from the persisted row.** Always read from `content_pieces.is_ymyl`,
  never re-derived at audit/publish time.
- **Failure codes, never prose.** The revise loop consumes the fixed taxonomy,
  not model free-text.
- **Illegal transitions rejected at the data layer.** The lifecycle FSM rejects
  every illegal transition (e.g. `draft → published`, or `approved → published`
  on a non-PUBLISH verdict) — not just the UI.
- **Tenancy.** Every `content_pieces` / `content_piece_versions` read and write is
  scoped by `client_id`; the workspace→client ownership is validated server-side
  before any write; a forged/foreign client id is rejected and never leaks.
- **Snapshot before forward.** A version snapshot is written before every forward
  move (`draft→review`, `review→approved`, `approved→published`).

## judge_criteria

Abstract review criteria for a `seo-audit` run (no concrete prompt wording — the
judge evaluates the *artifact + behavior*, not phrasing):

```yaml
judge_criteria:
  gate_integrity:
    - The two-stage gate ran: a Stage-A veto short-circuited to REJECT/REVISE with
      score === null and no composite; only a Stage-A-clean draft got a composite.
    - The full scorecard (eval_score / verdict / dimensions / failure codes) was
      persisted on the row as the audit trail.
  fail_closed:
    - A thrown / timed-out / skipped / missing eval BLOCKED publish (a blocking
      VETO_EVAL_FAILED or equivalent), never a silent pass.
    - publishEnabled defaulted OFF; with it off, nothing reached published.
  publish_gate:
    - The transition into published required verdict === PUBLISH AND a recorded
      human release AND an eval that actually ran; any missing clause blocked.
    - A YMYL piece additionally required a named author + credentials + citations.
  ymyl_from_row:
    - is_ymyl was read from the persisted content_pieces row, never re-derived; a
      brief-skipping draft still took the YMYL path.
  failure_codes:
    - The revise loop consumed the fixed failure codes, never raw judge prose.
  revise_cap:
    - The audit->revise loop was capped at 3 cycles; the 4th failure force-routed
      the piece to human review (status held at review, no further auto-draft).
  fsm_legality:
    - Every illegal transition was rejected at the data layer (the FSM), not just
      the UI; a version snapshot was written before every forward move.
  tenancy:
    - Every read/write was scoped by client_id; workspace->client ownership was
      validated before any write; a foreign client id was rejected and did not leak.
  kernel_backed:
    - The run drove the apps/agents audit + publish routes rather than
      re-implementing the gate / FSM / persistence; an unreachable app stopped the
      run instead of declaring a piece publishable.
```
