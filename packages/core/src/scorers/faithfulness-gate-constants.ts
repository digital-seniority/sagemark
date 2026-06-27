/**
 * Client-safe constants for the ContentEngine faithfulness gate.
 *
 * Extracted from faithfulness-gate.ts so client components (e.g. DraftResult.tsx)
 * can read UI thresholds WITHOUT importing the server-only gate module.
 */

/** UI threshold: show warning banner if sourcedPercent < this value */
export const FAITHFULNESS_WARNING_THRESHOLD = 70;
