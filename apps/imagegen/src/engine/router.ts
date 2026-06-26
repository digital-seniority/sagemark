/**
 * ImageGen — Router (`imagegen/1`).
 *
 * PORTED ~verbatim from flywheel-main `packages/videogen/imagegen/router.ts`.
 * Picks the model for a job (ImageGen Bible ch.02 routing). The job default
 * comes from `DEFAULT_MODEL_FOR_JOB` (SEO: hero → mid flux-flex, photo → draft
 * klein). The seam is built so budget/quality-aware routing (draft→mid→final
 * escalation) slots in without changing callers.
 */

import {
  DEFAULT_MODEL_FOR_JOB,
  getCapability,
  modelsForJob,
  type ModelCapability,
} from "./capability";
import type { ImageJob } from "./spec";

export interface RouteOptions {
  /** Force a specific tier instead of the job default. */
  tier?: ModelCapability["tier"];
  /** Force a specific model id (must be in the matrix + eligible for the job). */
  modelId?: string;
}

/** Resolve the model id to use for a job. Throws if an override is invalid. */
export function routeModel(job: ImageJob, opts: RouteOptions = {}): string {
  if (opts.modelId) {
    const cap = getCapability(opts.modelId); // throws UnknownModelError if absent
    if (!cap.jobs.includes(job)) {
      throw new Error(
        `Model "${opts.modelId}" is not eligible for job "${job}".`,
      );
    }
    return cap.id;
  }

  if (opts.tier) {
    const match = modelsForJob(job).find((m) => m.tier === opts.tier);
    if (!match) {
      throw new Error(
        `No "${opts.tier}"-tier model is eligible for job "${job}".`,
      );
    }
    return match.id;
  }

  return DEFAULT_MODEL_FOR_JOB[job];
}
