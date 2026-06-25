# Sagemark

**Marketing OS for the retirement home industry.**

Sagemark is a monorepo of standalone marketing microservices. Each service runs,
deploys, and is usable on its own, but they discover and call one another through
a shared service registry when a job needs more than one of them.

## Structure

```
sagemark/
├── apps/
│   ├── seo/                SEO Engine — gate-backed SEO/GEO content hubs (first app — see plans/seo-creator)  :3001
│   ├── imagegen/           Image Generation — brand-consistent campaign imagery          :3002
│   ├── videogen/           Video Generation — tour videos, explainers, social clips      :3003
│   ├── ppc/                PPC Manager — paid search/social for occupancy goals          :3004
│   └── intelligence/       Intelligence Layer — analytics, signals, orchestration        :3005
└── packages/
    ├── config/             @sagemark/config — shared TypeScript base configs
    └── core/               @sagemark/core — service registry + inter-service client
```

## How services talk to each other

No service hardcodes another's URL. The registry in
[`packages/core/src/services.ts`](packages/core/src/services.ts) is the single
source of truth for which services exist and how to reach them (local dev port or
deployed URL via env var). A service calls a sibling with the typed client:

```ts
import { callService } from "@sagemark/core";

// e.g. the SEO engine asking imagegen for a hero image for a content guide
const result = await callService<{ url: string }>("imagegen", "/api/run", {
  method: "POST",
  body: { brief: "warm, reassuring photo for a memory-care guide" },
});
```

Each service exposes at least:

- `GET /api/health` — liveness + version (shared shape from `@sagemark/core`)
- `POST /api/run` — primary action (currently a stub)

To deploy, set each service's base-URL env var (`SEO_SERVICE_URL`,
`IMAGEGEN_SERVICE_URL`, …) so siblings resolve the production URL instead of the
local dev port.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · pnpm workspaces · Turborepo

## Develop

```bash
pnpm install
pnpm dev          # runs every app via turbo
pnpm typecheck
pnpm build
```

Run a single service: `pnpm --filter @sagemark/seo dev`.
