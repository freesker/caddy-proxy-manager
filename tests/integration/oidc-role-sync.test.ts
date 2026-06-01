import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { groupMembers, oauthRoleMappings, groups, users, oauthProviders } from "@/src/lib/db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret } from "@/src/lib/secret";
import { syncUserGroupsFromRoles } from "@/src/lib/services/oidc-role-sync";

let db: TestDb;
const PROVIDER = "prov-1";

// La base de test applique les FK → seeder les lignes parentes (users, groups, providers).
beforeEach(async () => {
  db = createTestDb();
  const now = new Date().toISOString();
  await db.insert(users).values({ id: 10, email: "u10@example.com", createdAt: now, updatedAt: now });
  await db.insert(groups).values([
    { id: 1, name: "g1", createdAt: now, updatedAt: now },
    { id: 2, name: "g2", createdAt: now, updatedAt: now },
    { id: 99, name: "g99", createdAt: now, updatedAt: now },
  ]);
  await db.insert(oauthProviders).values([
    { id: PROVIDER, name: "P1", clientId: encryptSecret("c"), clientSecret: encryptSecret("s"), scopes: "openid", createdAt: now, updatedAt: now },
    { id: "other", name: "Other", clientId: encryptSecret("c"), clientSecret: encryptSecret("s"), scopes: "openid", createdAt: now, updatedAt: now },
  ]);
});

async function memberGroupIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  return rows.map((r) => r.groupId).sort((a, b) => a - b);
}

async function addMapping(role: string, groupId: number, providerId = PROVIDER) {
  await db.insert(oauthRoleMappings).values({
    providerId,
    role,
    groupId,
    createdAt: new Date().toISOString(),
  });
}

describe("syncUserGroupsFromRoles", () => {
  it("adds the user to mapped groups for roles they have", async () => {
    await addMapping("ops", 1);
    await addMapping("admin", 2);
    const res = await syncUserGroupsFromRoles(db, 10, PROVIDER, ["ops"]);
    expect(res.skipped).toBe(false);
    expect(await memberGroupIds(10)).toEqual([1]);
  });

  it("removes the user from a managed group when the role is gone", async () => {
    await addMapping("ops", 1);
    await db.insert(groupMembers).values({ groupId: 1, userId: 10, createdAt: new Date().toISOString() });
    const res = await syncUserGroupsFromRoles(db, 10, PROVIDER, []);
    expect(res.skipped).toBe(false);
    expect(await memberGroupIds(10)).toEqual([]);
  });

  it("skips entirely when roles is undefined (claim absent)", async () => {
    await addMapping("ops", 1);
    await db.insert(groupMembers).values({ groupId: 1, userId: 10, createdAt: new Date().toISOString() });
    const res = await syncUserGroupsFromRoles(db, 10, PROVIDER, undefined);
    expect(res.skipped).toBe(true);
    expect(await memberGroupIds(10)).toEqual([1]); // unchanged
  });

  it("does not touch non-managed groups", async () => {
    await addMapping("ops", 1);
    await db.insert(groupMembers).values({ groupId: 99, userId: 10, createdAt: new Date().toISOString() });
    await syncUserGroupsFromRoles(db, 10, PROVIDER, ["ops"]);
    expect(await memberGroupIds(10)).toEqual([1, 99]);
  });

  it("is scoped per provider", async () => {
    await addMapping("ops", 1); // provider prov-1
    await addMapping("ops", 2, "other"); // provider "other"
    await syncUserGroupsFromRoles(db, 10, PROVIDER, ["ops"]);
    expect(await memberGroupIds(10)).toEqual([1]); // group 2 (other provider) untouched
  });
});
