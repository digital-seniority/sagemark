# SEO Creator autonomous worker image (PR 006 / P0.W.2, lane worker-runtime).
#
# This image is the body of the per-run Vercel Sandbox microVM (D5/D9). It is
# NOT a Next.js server image — the worker is a long-running, non-serverless
# process that runs the autonomous brief->draft loop via the Claude Agent SDK
# (`agent-worker.ts`), driven by `sandbox-launch.ts` on the host side.
#
# SAFETY-MODEL NOTES baked into the image:
#   * `iptables` + `curl` are present so the launcher's in-VM egress hardening
#     ([[DR-010]]: DROP 169.254.0.0/16 + read-back probe) can run at boot.
#   * The image carries NO secrets. The per-run bridge JWT + Gateway base URL are
#     injected as env at `Sandbox.create` time (scrubbed env, acceptance #2/#6) —
#     never burned into a layer.
#   * The run executes as a non-root user; the model's FS access is mediated by
#     the workdir-scoped tool ([[DR-011]]), not a VM-level jail.
#
# Base: node24 to match the Sandbox `runtime: 'node24'` the launcher requests.
#
# BUILD CONTEXT (A.011.9, judge fix #2): this Dockerfile MUST be built from the
# REPO ROOT so that every COPY source resolves under one consistent context — the
# worker manifests/artifacts under `apps/seo/...` AND the vendored suite under
# `skills/...`. There is no single sub-tree context that satisfies both, so all
# COPY sources below are repo-root-relative. Build invocation:
#
#   docker build -f apps/seo/src/worker/Dockerfile .
#
# (run from the repo root; the trailing `.` is the repo-root build context).

FROM node:24-bookworm-slim

# Tools the boot preflight needs in-VM: iptables (MMDS DROP), curl (read-back
# egress probe), and ca-certificates (TLS to the Gateway + host bridge).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
      iptables \
      curl \
      ca-certificates \
      sudo \
  && rm -rf /var/lib/apt/lists/*

# Non-root run user (mirrors the Sandbox base-image convention). Granted sudo for
# the single privileged op the launcher runs at boot: the iptables DROP.
RUN useradd --create-home --shell /bin/bash worker \
  && echo "worker ALL=(ALL) NOPASSWD: /usr/sbin/iptables" > /etc/sudoers.d/worker-iptables \
  && chmod 0440 /etc/sudoers.d/worker-iptables

# The ephemeral working dir the loop is jailed to (WORKER_WORKDIR). Wiped on
# lease handoff (acceptance #5); never persisted across runs (acceptance #1 —
# state lives host-side in Supabase, not here).
ENV WORKER_WORKDIR=/home/worker/run
RUN mkdir -p ${WORKER_WORKDIR} && chown -R worker:worker /home/worker

WORKDIR /home/worker/app

# Install the worker runtime deps + the Claude Agent SDK (which vendors the
# `claude` CLI the SDK spawns). Copy manifests first for layer caching.
# Repo-root-relative source (build context = repo root): the worker shares the
# apps/seo manifest (no separate worker package.json exists).
COPY apps/seo/package.json ./
RUN npm install --omit=dev \
  && npm install @anthropic-ai/claude-agent-sdk @vercel/sandbox

# The compiled worker entrypoint (built from apps/seo/src/worker/*.ts to
# apps/seo/dist/, so ENTRYPOINT below resolves dist/worker/entry.js). Repo-root-
# relative source for the single consistent build context.
COPY apps/seo/dist/ ./dist/

# A.011.9: COPY the vendored seo-copywriter suite tree into the image so the
# worker can load the REAL seo-blog-writer SKILL.md (DR-022) IN the Sandbox VM.
# Without this the load would rely on settingSources:["project"] resolving an
# on-disk skills dir that does not exist in the image. The loader
# (`skills/load-suite.ts`) resolves `skills/seo-copywriter-skill-package/
# seo-copywriter` RELATIVE to the worker app root (process.cwd() == WORKDIR ==
# /home/worker/app), so the tree is COPY'd to exactly that relative path. The
# build context root is the repo root, so the source is the in-repo package.
COPY skills/seo-copywriter-skill-package/seo-copywriter ./skills/seo-copywriter-skill-package/seo-copywriter

USER worker

# The worker reads its whole world from the scrubbed env injected at create time:
#   ANTHROPIC_BASE_URL  (Gateway)         ANTHROPIC_AUTH_TOKEN (per-run bridge JWT)
#   SEO_HOST_BASE_URL   RUN_BRIDGE_JWT    RUN_ID / RUN_WORKSPACE_ID / RUN_CLIENT_ID
# It carries NO ambient secrets (no Supabase key, no raw provider key).
ENTRYPOINT ["node", "dist/worker/entry.js"]
