# DR-034 — comment-thread-version-left-on-uses-version-column

**Date:** 2026-06-26
**Run:** #022 (judge-flagged DR-NEEDED, P1.C.1 / PR 018, client-review shard)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

P1.C.1 (PR 018) builds the tokenized client-review surface. AC#3 requires a pinned comment to persist `version_left_on` (the piece version a pin was anchored to). The canonical comment table is RFC §133 `comment_threads`, whose listed columns include `version` but not a separately-named `version_left_on`.

## Problem

Record the "version a comment/pin was left on" as a distinct `version_left_on` column, or reuse the canonical `version` column already in the `comment_threads` schema (§133)?

## Options considered

- **Option A: reuse the `version` column.**
  - Pros: matches the RFC §133 canonical schema verbatim (no schema drift); one source of truth for "which version this thread belongs to"; the index `(piece_id, version, status)` already serves thread-by-version queries.
  - Cons: the AC's literal field name (`version_left_on`) is not present as a column — relies on a documented convention.
- **Option B: add a distinct `version_left_on` column.**
  - Pros: literal name-match to the AC.
  - Cons: duplicates `version`; invites drift (which one is authoritative when a thread is carried to a new version?); diverges from the §133 canonical schema.

## Decision

**Option A.** A pin/comment left on version N has `comment_threads.version = N`; `version_left_on` is satisfied by the canonical `version` column. Documented in the `0036_comment_threads.sql` header and the Drizzle schema comment.

## Consequences

- PR 019 (P1.C.2 — "Request changes" → edit loop + thread resolution) inherits this convention: a thread "addressed in vN" compares against `comment_threads.version`, and thread-carry-forward semantics (if any) must be defined against `version`, not a second column.
- If a future requirement needs BOTH "version a pin was authored on" AND "version a thread currently applies to" as distinct facts, revisit and add the second column then (with a migration) — not pre-emptively.

## Links

[[DR-031]] (sign-off/version immutability), P1.C.1 / PR 018, RFC §133 (`comment_threads`).
