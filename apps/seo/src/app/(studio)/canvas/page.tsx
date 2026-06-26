/**
 * Studio canvas route (PR 010 / P1.U.1) — mounts the three-zone agent canvas.
 *
 * A Server Component that resolves the operator (`requireOperator`, the studio
 * auth chokepoint) then renders the CLIENT `SeoStudioCanvas`. The canvas opens its
 * own SSE subscription to `/api/run` (PR 007) once a run is dispatched; this route
 * is the static shell the client canvas hydrates into.
 *
 * SCOPE: this is the SHELL mount. The run-dispatch trigger (POST /api/run to obtain
 * `streamUrl`), the brief resolution from a persisted content_piece, and the
 * editor/version internals are later PRs — this route renders the canvas idle with
 * no live run, which is the correct first-paint state.
 *
 * ROLLBACK: delete this route file; the studio home + the PR 009 DraftResult
 * operator view are untouched.
 *
 * Colour from globals.css tokens (no hardcoded palette). Clean ASCII / UTF-8.
 */

import { requireOperator } from "@/lib/auth";
import { SeoStudioCanvas } from "../SeoStudioCanvas";

export default async function StudioCanvasPage() {
  await requireOperator();

  // The shell mounts idle: no `streamUrl` until a run is dispatched (later PR), and
  // no brief until a content_piece is resolved. The canvas renders its idle state.
  return <SeoStudioCanvas streamUrl={null} brief={null} />;
}
