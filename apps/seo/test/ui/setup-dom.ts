/**
 * setup-dom — jsdom test setup for the PR 011 / P1.U.2 UI interaction suites.
 *
 * Imported at the top of each `*.dom.test.tsx` file (which also carries the
 * `// @vitest-environment jsdom` directive). It registers `@testing-library/jest-dom`
 * custom matchers (toBeInTheDocument, toHaveTextContent, ...) and auto-cleans the
 * rendered DOM after every test so the jsdom suites stay isolated. Importing it
 * per-file (rather than a global setupFiles) keeps the jsdom dependency entirely
 * out of the existing node-env suites.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
