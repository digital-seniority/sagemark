/**
 * The Sagemark service registry.
 *
 * Every microservice in the platform is registered here once. The registry is
 * the single source of truth for:
 *   - which services exist (`ServiceName`)
 *   - how to reach them in dev (a stable local port) and in prod (an env var)
 *   - human-facing metadata for dashboards and routing UIs
 *
 * Services are standalone apps — each can run, deploy, and be used on its own —
 * but they discover and call one another through this registry via
 * `@sagemark/core/client`.
 */

export type ServiceName =
  | "seo"
  | "imagegen"
  | "videogen"
  | "ppc"
  | "intelligence";

export interface ServiceDescriptor {
  /** Stable id, matches the app directory name under `apps/`. */
  name: ServiceName;
  /** Human-facing title. */
  title: string;
  /** One-line description of what the service does. */
  description: string;
  /** Port used by `next dev` locally so services can reach each other. */
  devPort: number;
  /** Env var holding the deployed base URL (overrides the dev default). */
  baseUrlEnvVar: string;
}

export const SERVICES: Record<ServiceName, ServiceDescriptor> = {
  seo: {
    name: "seo",
    title: "SEO Engine",
    description:
      "Generates and optimizes search-first content and on-page structure for senior-living sites.",
    devPort: 3001,
    baseUrlEnvVar: "SEO_SERVICE_URL",
  },
  imagegen: {
    name: "imagegen",
    title: "Image Generation",
    description:
      "Produces brand-consistent imagery for campaigns, listings, and community pages.",
    devPort: 3002,
    baseUrlEnvVar: "IMAGEGEN_SERVICE_URL",
  },
  videogen: {
    name: "videogen",
    title: "Video Generation",
    description:
      "Creates tour videos, explainers, and social clips from community content.",
    devPort: 3003,
    baseUrlEnvVar: "VIDEOGEN_SERVICE_URL",
  },
  ppc: {
    name: "ppc",
    title: "PPC Manager",
    description:
      "Plans, launches, and tunes paid-search and social campaigns for occupancy goals.",
    devPort: 3004,
    baseUrlEnvVar: "PPC_SERVICE_URL",
  },
  intelligence: {
    name: "intelligence",
    title: "Intelligence Layer",
    description:
      "Shared analytics, market signals, and orchestration across the other services.",
    devPort: 3005,
    baseUrlEnvVar: "INTELLIGENCE_SERVICE_URL",
  },
};

export const SERVICE_NAMES = Object.keys(SERVICES) as ServiceName[];

/**
 * Resolve the base URL for a service.
 *
 * Prefers the deployed URL from the service's env var; falls back to the local
 * dev port. This is what makes a service callable both standalone and from a
 * sibling service.
 */
export function getServiceBaseUrl(name: ServiceName): string {
  const descriptor = SERVICES[name];
  const fromEnv = process.env[descriptor.baseUrlEnvVar];
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, "");
  }
  return `http://localhost:${descriptor.devPort}`;
}
