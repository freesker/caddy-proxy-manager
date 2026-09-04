import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function resetDbModuleState() {
  vi.resetModules();
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __SQLITE_CLIENT__?: unknown }).__SQLITE_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

afterEach(() => {
  process.env.DATABASE_URL = ":memory:";
  resetDbModuleState();
});

describe("API token deletion authorization", () => {
  it("makes another user's token indistinguishable from a nonexistent ID", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cpm-api-token-auth-"));
    const databasePath = join(directory, "tokens.db");

    try {
      process.env.DATABASE_URL = `file:${databasePath}`;
      resetDbModuleState();

      const [{ default: db, nowIso }, { apiTokens, users }, { deleteApiToken }] = await Promise.all([
        import("@/src/lib/db"),
        import("@/src/lib/db/schema"),
        import("@/src/lib/models/api-tokens"),
      ]);
      const now = nowIso();
      const [owner, otherUser, admin] = await db.insert(users).values([
        {
          email: "owner@example.com", name: "Owner", role: "user", provider: "credentials",
          subject: "owner", status: "active", createdAt: now, updatedAt: now,
        },
        {
          email: "other@example.com", name: "Other", role: "user", provider: "credentials",
          subject: "other", status: "active", createdAt: now, updatedAt: now,
        },
        {
          email: "admin@example.com", name: "Admin", role: "admin", provider: "credentials",
          subject: "admin", status: "active", createdAt: now, updatedAt: now,
        },
      ]).returning();
      const [token] = await db.insert(apiTokens).values({
        name: "Owner token",
        tokenHash: "a".repeat(64),
        createdBy: owner.id,
        createdAt: now,
      }).returning();

      await expect(deleteApiToken(token.id, otherUser.id, false))
        .rejects.toMatchObject({ name: "NotFoundError", message: "Token not found" });
      await expect(deleteApiToken(token.id + 10_000, otherUser.id, false))
        .rejects.toMatchObject({ name: "NotFoundError", message: "Token not found" });
      expect(await db.query.apiTokens.findFirst({
        where: (table, { eq }) => eq(table.id, token.id),
      })).toBeDefined();

      await deleteApiToken(token.id, admin.id, true);
      expect(await db.query.apiTokens.findFirst({
        where: (table, { eq }) => eq(table.id, token.id),
      })).toBeUndefined();

      db.$client.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
