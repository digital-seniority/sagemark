/**
 * revise-client — the browser caller for the direct in-place edit (Slice 3).
 *
 * POSTs the operator's edited full body to /api/revise (tenancy-minimal:
 * { clientId, pieceId, body }) and returns the re-gated result. A non-OK response
 * surfaces the route's stable error `code` so the editor can show a precise reason
 * (piece-not-editable / rate-limited / stale-edit / …). Pure transport — no React.
 */

export interface ReviseResult {
  version: number;
  verdict: string | null;
  score: number | null;
  stageAClean: boolean;
  failureCodes: string[];
  newHash: string;
}

export class ReviseError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "ReviseError";
  }
}

export interface ReviseArgs {
  clientId: string;
  pieceId: string;
  body: string;
  /** OPTIONAL SHA-256 stale-edit guard; omitted = last-write-wins. */
  baseVersionHash?: string;
}

export async function reviseDraft(
  args: ReviseArgs,
  fetchImpl?: typeof fetch,
): Promise<ReviseResult> {
  const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : null);
  if (!doFetch) throw new ReviseError("no-fetch", 0);

  const res = await doFetch("/api/revise", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    let code = `http-${res.status}`;
    try {
      const j = (await res.json()) as { code?: string };
      if (j?.code) code = j.code;
    } catch {
      // keep the http-status fallback code
    }
    throw new ReviseError(code, res.status);
  }
  return (await res.json()) as ReviseResult;
}
