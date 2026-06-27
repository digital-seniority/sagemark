/**
 * activation.test.ts — the go-live config gates (DR-026 activation, DR-037).
 *
 * Proves the LOAD-BEARING safe-defaults of `resolveActivation` / `publishEnabled` /
 * `isPilot`:
 *
 *   1. INERT BY DEFAULT — with NO env set, every gate is OFF
 *      ({ publishEnabled:false, pilot:false, somLive:false }). A merge changes
 *      nothing live.
 *   2. publishEnabled DEFAULT OFF — never on without BOTH an explicit PUBLISH_ENABLED
 *      flag AND service-role creds; an explicit flag with no creds is still OFF.
 *   3. DR-037 — production ⇒ pilot:false, ALWAYS. `pilot:true` only outside
 *      production (VERCEL_ENV !== 'production') with an explicit PILOT flag.
 *   4. somLive mirrors the single SOM_LIVE gate.
 *
 * Env is injected (the functions accept an `env` arg) so no process.env mutation is
 * needed except for the creds-present branch, which `resolveActivation` reads via
 * `hasServiceRoleCreds()` (the adapter creds readers read process.env directly) —
 * that one case sets + restores SUPABASE_URL/SERVICE_ROLE_KEY around the assertion.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  resolveActivation,
  publishEnabled,
  isPilot,
  hasServiceRoleCreds,
} from "@/lib/activation";

// Snapshot the creds env so the creds-present case can be restored.
const SAVED = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function clearCreds(): void {
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE;
}

function setCreds(): void {
  process.env.SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub-key";
}

afterEach(() => {
  // Restore creds env to its original state.
  if (SAVED.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = SAVED.url;
  if (SAVED.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = SAVED.key;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE;
});

describe("activation: inert by default", () => {
  it("with NO env set, every gate is OFF (a merge changes nothing live)", () => {
    clearCreds();
    const gates = resolveActivation({});
    expect(gates).toEqual({
      publishEnabled: false,
      pilot: false,
      somLive: false,
    });
  });
});

describe("activation: publishEnabled DEFAULT OFF", () => {
  it("is OFF with no flag and no creds", () => {
    clearCreds();
    expect(resolveActivation({}).publishEnabled).toBe(false);
    expect(publishEnabled({})).toBe(false);
  });

  it("is OFF with the flag set but NO service-role creds (creds required)", () => {
    clearCreds();
    expect(resolveActivation({ PUBLISH_ENABLED: "1" }).publishEnabled).toBe(false);
    expect(resolveActivation({ CONTENT_PUBLISH_ENABLED: "true" }).publishEnabled).toBe(
      false,
    );
  });

  it("is OFF with creds present but NO explicit flag", () => {
    setCreds();
    expect(hasServiceRoleCreds()).toBe(true);
    expect(resolveActivation({}).publishEnabled).toBe(false);
  });

  it("is ON only when an explicit flag AND service-role creds are both present", () => {
    setCreds();
    expect(resolveActivation({ PUBLISH_ENABLED: "1" }).publishEnabled).toBe(true);
    expect(publishEnabled({ PUBLISH_ENABLED: "true" })).toBe(true);
  });
});

describe("activation: DR-037 production => pilot:false (LOAD-BEARING)", () => {
  it("production is ALWAYS pilot:false, even with the PILOT flag set", () => {
    clearCreds();
    expect(
      resolveActivation({ VERCEL_ENV: "production", PILOT: "1" }).pilot,
    ).toBe(false);
    expect(isPilot({ VERCEL_ENV: "production", PILOT: "true" })).toBe(false);
  });

  it("pilot:true ONLY outside production with an explicit PILOT flag", () => {
    clearCreds();
    // Non-production + explicit flag => pilot:true.
    expect(resolveActivation({ VERCEL_ENV: "preview", PILOT: "1" }).pilot).toBe(true);
    expect(resolveActivation({ VERCEL_ENV: "development", PILOT: "true" }).pilot).toBe(
      true,
    );
    // Non-production but NO flag => still false (the flag is required).
    expect(resolveActivation({ VERCEL_ENV: "preview" }).pilot).toBe(false);
  });
});

describe("activation: somLive mirrors the single SOM_LIVE gate", () => {
  it("is OFF unless SOM_LIVE is explicitly on", () => {
    clearCreds();
    expect(resolveActivation({}).somLive).toBe(false);
    expect(resolveActivation({ SOM_LIVE: "0" }).somLive).toBe(false);
    expect(resolveActivation({ SOM_LIVE: "1" }).somLive).toBe(true);
    expect(resolveActivation({ SOM_LIVE: "true" }).somLive).toBe(true);
  });
});
