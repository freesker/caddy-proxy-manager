import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertValidInstanceSyncToken,
  instanceSyncTokenValidationError,
  isValidInstanceSyncToken,
  MAX_INSTANCE_SYNC_TOKEN_LENGTH,
} from "@/src/lib/instance-sync-token";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("instance sync token policy", () => {
  it("rejects missing, short, and whitespace-padded credentials", () => {
    expect(isValidInstanceSyncToken(undefined)).toBe(false);
    expect(isValidInstanceSyncToken("a".repeat(31))).toBe(false);
    expect(isValidInstanceSyncToken("a".repeat(MAX_INSTANCE_SYNC_TOKEN_LENGTH + 1))).toBe(false);
    expect(isValidInstanceSyncToken(` ${"a".repeat(32)}`)).toBe(false);
    expect(instanceSyncTokenValidationError("a".repeat(32))).toBeNull();
  });

  it("gives operators a secure generation command", () => {
    expect(() => assertValidInstanceSyncToken("short", "INSTANCE_SYNC_TOKEN"))
      .toThrow(/openssl rand -hex 32/);
  });

  it("fails production startup when an environment-configured slave has a weak token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "runtime");
    vi.stubEnv("SESSION_SECRET", "s".repeat(32));
    vi.stubEnv("ADMIN_USERNAME", "admin");
    vi.stubEnv("ADMIN_PASSWORD", "Strong-Admin-Passw0rd!");
    vi.stubEnv("INSTANCE_MODE", "slave");
    vi.stubEnv("INSTANCE_SYNC_TOKEN", "weak");
    vi.resetModules();

    const { validateProductionConfig } = await import("@/src/lib/config");

    expect(() => validateProductionConfig()).toThrow(/INSTANCE_SYNC_TOKEN.*at least 32/);
  });

  it("accepts a sufficiently long token for an environment-configured production slave", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "runtime");
    vi.stubEnv("SESSION_SECRET", "s".repeat(32));
    vi.stubEnv("ADMIN_USERNAME", "admin");
    vi.stubEnv("ADMIN_PASSWORD", "Strong-Admin-Passw0rd!");
    vi.stubEnv("INSTANCE_MODE", "slave");
    vi.stubEnv("INSTANCE_SYNC_TOKEN", "a".repeat(32));
    vi.resetModules();

    const { validateProductionConfig } = await import("@/src/lib/config");

    expect(() => validateProductionConfig()).not.toThrow();
  });
});
