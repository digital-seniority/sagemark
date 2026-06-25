/**
 * Typed client for service-to-service calls.
 *
 * A service never hardcodes another service's URL — it calls `callService()`,
 * which resolves the target through the registry. This keeps each service
 * standalone (it only depends on the registry, not on its siblings' internals)
 * while still letting them collaborate where needed.
 */

import { getServiceBaseUrl, type ServiceName } from "./services";

export interface CallServiceOptions extends Omit<RequestInit, "body"> {
  /** JSON body — serialized automatically. */
  body?: unknown;
  /** Per-call timeout in ms (default 30s). */
  timeoutMs?: number;
}

export class ServiceCallError extends Error {
  constructor(
    public readonly service: ServiceName,
    public readonly path: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ServiceCallError";
  }
}

/**
 * Call another service's HTTP API and parse a JSON response.
 *
 * @example
 *   const result = await callService<{ score: number }>("seo", "/api/score", {
 *     method: "POST",
 *     body: { url: "https://cedarhollow.example/about" },
 *   });
 */
export async function callService<TResponse = unknown>(
  service: ServiceName,
  path: string,
  options: CallServiceOptions = {},
): Promise<TResponse> {
  const { body, timeoutMs = 30_000, headers, ...rest } = options;
  const base = getServiceBaseUrl(service);
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new ServiceCallError(
        service,
        path,
        response.status,
        `Service "${service}" returned ${response.status} for ${path}`,
      );
    }

    return (await response.json()) as TResponse;
  } finally {
    clearTimeout(timer);
  }
}
