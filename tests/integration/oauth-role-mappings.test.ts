import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { oauthRoleMappings, groups, oauthProviders } from "@/src/lib/db/schema";
import { encryptSecret } from "@/src/lib/secret";
import { eq } from "drizzle-orm";

let db: TestDb;

// La base de test applique les FK → seeder les providers et groupes parents.
beforeEach(async () => {
  db = createTestDb();
  const now = new Date().toISOString();
  await db.insert(groups).values([
    { id: 1, name: "g1", createdAt: now, updatedAt: now },
    { id: 2, name: "g2", createdAt: now, updatedAt: now },
  ]);
  await db.insert(oauthProviders).values([
    { id: "p1", name: "P1", clientId: encryptSecret("c"), clientSecret: encryptSecret("s"), scopes: "openid", createdAt: now, updatedAt: now },
    { id: "p2", name: "P2", clientId: encryptSecret("c"), clientSecret: encryptSecret("s"), scopes: "openid", createdAt: now, updatedAt: now },
  ]);
});

async function insertMapping(providerId: string, role: string, groupId: number) {
  return db
    .insert(oauthRoleMappings)
    .values({ providerId, role, groupId, createdAt: new Date().toISOString() })
    .returning();
}

describe("oauth_role_mappings table", () => {
  it("enforces uniqueness on (providerId, role, groupId)", async () => {
    await insertMapping("p1", "ops", 1);
    await expect(insertMapping("p1", "ops", 1)).rejects.toThrow();
  });

  it("allows the same role to map to multiple groups", async () => {
    await insertMapping("p1", "ops", 1);
    await insertMapping("p1", "ops", 2);
    const rows = await db
      .select()
      .from(oauthRoleMappings)
      .where(eq(oauthRoleMappings.providerId, "p1"));
    expect(rows).toHaveLength(2);
  });

  it("deleteMappingsForProvider removes only that provider's rows", async () => {
    const { deleteMappingsForProvider } = await import(
      "@/src/lib/models/oauth-role-mappings"
    );
    await insertMapping("p1", "ops", 1);
    await insertMapping("p2", "ops", 1);
    await deleteMappingsForProvider(db, "p1");
    const remaining = await db.select().from(oauthRoleMappings);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].providerId).toBe("p2");
  });

  it("deleteMappingsForGroup removes only that group's rows", async () => {
    const { deleteMappingsForGroup } = await import(
      "@/src/lib/models/oauth-role-mappings"
    );
    await insertMapping("p1", "ops", 1);
    await insertMapping("p1", "admin", 2);
    await deleteMappingsForGroup(db, 1);
    const remaining = await db.select().from(oauthRoleMappings);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].groupId).toBe(2);
  });
});
