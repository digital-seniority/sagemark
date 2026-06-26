# DR-037 — d6-reviewer-seeded-placeholder-for-pilot

**Date:** 2026-06-26
**Run:** #022 follow-up (James decision, non-eng input #3)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

P1.C.2 (PR 019 — "Request changes" → edit loop + named sign-off + approval-debt KPI) is gated on the **D6 credentialed reviewer**: the credentialed human whose name + credential becomes the server-resolved YMYL "Reviewed by [Name, Credential]" byline, backed by an **active** `byline_authorizations` row that `canPublish()` reads as the release source of truth (§11.5; a `client_signoffs` row is structurally incapable of it). Securing a real credentialed reviewer is a real-world (non-engineering) deliverable that was blocking the lane.

## Decision

**Build P1.C.2 against a SEEDED PLACEHOLDER `byline_authorizations` row for the pilot** (James, 2026-06-26):

- Placeholder: `name: "Pending Clinical Reviewer"`, `credential: "RN"` (placeholder), `scope: ymyl`, `status: active` — **pilot/non-production only**.
- A **real** credentialed reviewer (actual name + verifiable credential + authorization + relationship to the client) **MUST replace the placeholder before any real YMYL piece is published**. The placeholder exists to unblock engineering now without faking E-E-A-T at go-live.

## Consequences

- P1.C.2 (PR 019) is **SPEC-UNBLOCKED**. It can be built + tested against the seeded authorization: the two-table split (`client_signoffs` advisory vs `credentialed_releases` the only release) and the active-authorization fail-closed write (revoked/expired/inactive → refused) are all testable against the placeholder.
- **Go-live guard (REQUIRED before production YMYL publish):** add a check that the active byline reviewer is NOT the placeholder (`name != "Pending Clinical Reviewer"` / a `placeholder:true` flag on the seed row) — a real YMYL release must resolve to a real credentialed person. Flag this in the P1.C.2 PR + the go-live checklist.
- The placeholder must not be reachable as a release authority in any production/live tenant — seed it only in the pilot workspace, and keep the live-publish path gated (publishEnabled OFF) until the real reviewer is in.

## Links

P1.C.2 / PR 019; [[DR-031]] (sign-off immutability); engineering-rfc §11.5 (byline authorization); the credentialed-release vs client-signoff split.
