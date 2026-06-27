import { describe, expect, it } from "vitest";

import {
  assertWorkerEnvClean,
  lintWorkerEnv,
} from "./worker-env-lint";

describe("lintWorkerEnv — no raw Anthropic endpoint + provider key in worker config", () => {
  it("passes a Gateway-only worker env (base URL + bridge JWT, no provider key)", () => {
    const env = {
      AI_GATEWAY_BASE_URL: "https://gateway.ai.vercel.com/v1",
      AI_GATEWAY_API_KEY: "vck_run_scoped_bridge_jwt",
    };
    expect(lintWorkerEnv(env)).toEqual([]);
  });

  it("FAILS when a raw Anthropic endpoint and a provider key appear together", () => {
    const env = {
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_API_KEY: "sk-ant-deadbeef",
    };
    const violations = lintWorkerEnv(env);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.offendingKeys).toContain("ANTHROPIC_API_KEY");
    expect(violations[0]!.offendingKeys).toContain("ANTHROPIC_BASE_URL");
    expect(() => assertWorkerEnvClean(env)).toThrow(/worker env lint failed/);
  });

  it("detects a provider key by sk-ant- value shape even under a non-standard key name", () => {
    const env = {
      SOME_URL: "https://api.anthropic.com/v1/messages",
      MODEL_CREDENTIAL: "sk-ant-api03-xxxxx",
    };
    expect(lintWorkerEnv(env)).toHaveLength(1);
  });

  it("a raw endpoint ALONE (no key) does not fail — Gateway worker may reference it harmlessly", () => {
    const env = { DOC_NOTE: "do not call api.anthropic.com directly" };
    expect(lintWorkerEnv(env)).toEqual([]);
    expect(() => assertWorkerEnvClean(env)).not.toThrow();
  });

  it("a provider key ALONE (no raw endpoint) does not fail at the worker-env layer", () => {
    // The host/CI context legitimately carries a key; the pairing is the hazard.
    const env = { ANTHROPIC_API_KEY: "sk-ant-host-only" };
    expect(lintWorkerEnv(env)).toEqual([]);
  });

  it("ignores undefined / empty values", () => {
    const env = {
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_BASE_URL: "",
    };
    expect(lintWorkerEnv(env)).toEqual([]);
  });
});
