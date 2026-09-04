import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { groupMembers, oauthRoleMappings, groups, users, oauthProviders, accounts } from "@/src/lib/db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret } from "@/src/lib/secret";
import { syncUserGroupsFromRoles } from "@/src/lib/services/oidc-role-sync";
import { randomUUID } from "node:crypto";
import { syncRolesForUserSession } from "@/src/lib/services/oidc-role-sync";

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

function makeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

describe("syncRolesForUserSession", () => {
  it("applies roles from the stored ID token for OAuth accounts", async () => {
    const providerId = randomUUID();
    const now = new Date().toISOString();
    await db.insert(oauthProviders).values({
      id: providerId, name: "Keycloak", type: "oidc",
      clientId: encryptSecret("cid"), clientSecret: encryptSecret("cs"),
      scopes: "openid", rolesClaim: null,
      autoLink: false, enabled: true, source: "ui", createdAt: now, updatedAt: now,
    });
    await db.insert(oauthRoleMappings).values({ providerId, role: "ops", groupId: 1, createdAt: now });
    await db.insert(oauthRoleMappings).values({ providerId, role: "admin", groupId: 2, createdAt: now });

    const idToken = makeIdToken({
      sub: "kc-user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      realm_access: { roles: ["ops"] },
    });
    await db.insert(accounts).values({
      userId: 10, accountId: "kc-user-1", providerId, issuer: `local:oauth:${providerId}`,
      idToken: encryptSecret(idToken), createdAt: now, updatedAt: now,
    });

    await syncRolesForUserSession(db, 10);
    expect(await memberGroupIds(10)).toEqual([1]);
  });

  it("ignores credential accounts and skips expired ID tokens", async () => {
    const providerId = randomUUID();
    const now = new Date().toISOString();
    await db.insert(oauthProviders).values({
      id: providerId, name: "KC", type: "oidc",
      clientId: encryptSecret("cid"), clientSecret: encryptSecret("cs"),
      scopes: "openid", rolesClaim: null,
      autoLink: false, enabled: true, source: "ui", createdAt: now, updatedAt: now,
    });
    await db.insert(oauthRoleMappings).values({ providerId, role: "ops", groupId: 1, createdAt: now });
    await db.insert(accounts).values({
      userId: 10, accountId: "10", providerId: "credential", issuer: "local:credential",
      password: "hash", createdAt: now, updatedAt: now,
    });
    const expired = makeIdToken({
      sub: "kc-user-1", exp: Math.floor(Date.now() / 1000) - 10,
      realm_access: { roles: ["ops"] },
    });
    await db.insert(accounts).values({
      userId: 10, accountId: "kc-user-1", providerId, issuer: `local:oauth:${providerId}`,
      idToken: encryptSecret(expired), createdAt: now, updatedAt: now,
    });

    await syncRolesForUserSession(db, 10);
    expect(await memberGroupIds(10)).toEqual([]);
  });
});
