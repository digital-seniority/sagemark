/** Shared shape every service's `/api/health` endpoint returns. */

import type { ServiceName } from "./services";

export interface HealthResponse {
  service: ServiceName;
  status: "ok";
  version: string;
  /** ISO timestamp, set by the responding service. */
  time: string;
}

export function makeHealthResponse(
  service: ServiceName,
  version: string,
): HealthResponse {
  return {
    service,
    status: "ok",
    version,
    time: new Date().toISOString(),
  };
}
