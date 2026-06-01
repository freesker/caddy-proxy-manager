import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, groupMembers, oauthProviders, oauthRoleMappings } from "../db/schema";
import { decryptSecret, isEncryptedSecret } from "../secret";

/** Accepts both the bun-sqlite driver (prod) and better-sqlite3 (tests) — both synchronous. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SyncDb = BaseSQLiteDatabase<"sync", any, any, any>;

export const DEFAULT_ROLES_CLAIM = "realm_access.roles";

/** Decodes a JWT payload (no verification — already validated upstream by better-auth). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Extracts a roles array from a dotted claim path (e.g. realm_access.roles).
 * - missing path     → undefined (claim absent → the sync is SKIPPED)
 * - non-array value  → undefined (likely misconfiguration → SKIPPED)
 * - array (even empty) → string[]
 */
export function extractRoles(
  claims: Record<string, unknown>,
  claimPath: string
): string[] | undefined {
  let cur: unknown = claims;
  for (const part of claimPath.split(".")) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  if (Array.isArray(cur)) return cur.map((v) => String(v));
  return undefined;
}

/**
 * Computes membership add/remove deltas, limited to "managed" groups
 * (targets of at least one mapping). Non-managed groups are never touched.
 */
export function computeMembershipChanges(input: {
  managedGroupIds: number[];
  targetGroupIds: number[];
  currentGroupIds: number[];
}): { toAdd: number[]; toRemove: number[] } {
  const managed = new Set(input.managedGroupIds);
  const target = new Set(input.targetGroupIds.filter((g) => managed.has(g)));
  const current = new Set(input.currentGroupIds);

  const toAdd = [...target].filter((g) => !current.has(g));
  const toRemove = [...current].filter((g) => managed.has(g) && !target.has(g));
  return { toAdd, toRemove };
}

export async function syncUserGroupsFromRoles(
  database: SyncDb,
  userId: number,
  providerId: string,
  roles: string[] | undefined
): Promise<{ skipped: boolean; added: number[]; removed: number[] }> {
  if (roles === undefined) {
    console.warn(
      `[oidc-role-sync] roles claim absent for user ${userId} (provider ${providerId}); skipping group sync`
    );
    return { skipped: true, added: [], removed: [] };
  }

  const mappings = await database
    .select({ role: oauthRoleMappings.role, groupId: oauthRoleMappings.groupId })
    .from(oauthRoleMappings)
    .where(eq(oauthRoleMappings.providerId, providerId));

  if (mappings.length === 0) return { skipped: false, added: [], removed: [] };

  const managedGroupIds = [...new Set(mappings.map((m) => m.groupId))];
  const roleSet = new Set(roles);
  const targetGroupIds = [
    ...new Set(mappings.filter((m) => roleSet.has(m.role)).map((m) => m.groupId)),
  ];

  const currentRows = await database
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  const currentGroupIds = currentRows.map((r) => r.groupId);

  const { toAdd, toRemove } = computeMembershipChanges({
    managedGroupIds,
    targetGroupIds,
    currentGroupIds,
  });

  const now = new Date().toISOString();
  for (const groupId of toAdd) {
    await database.insert(groupMembers).values({ groupId, userId, createdAt: now });
  }
  if (toRemove.length > 0) {
    await database
      .delete(groupMembers)
      .where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, toRemove)));
  }

  return { skipped: false, added: toAdd, removed: toRemove };
}

/**
 * Syncs a user's groups from the roles present in the OIDC ID tokens stored on
 * their accounts. Called on every login (session.create.after). Expired tokens are
 * skipped to avoid re-applying stale roles during a non-OIDC login (e.g. credentials).
 */
export async function syncRolesForUserSession(
  database: SyncDb,
  userId: number
): Promise<void> {
  const accountRows = await database
    .select({ providerId: accounts.providerId, idToken: accounts.idToken })
    .from(accounts)
    .where(eq(accounts.userId, userId));

  for (const acc of accountRows) {
    if (acc.providerId === "credential" || !acc.idToken) continue;

    let raw = acc.idToken;
    if (isEncryptedSecret(raw)) {
      try {
        raw = decryptSecret(raw);
      } catch {
        continue;
      }
    }

    const payload = decodeJwtPayload(raw);
    if (!payload) continue;

    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    if (exp > 0 && exp * 1000 < Date.now()) continue; // expired token → ignore

    const providerRows = await database
      .select({ rolesClaim: oauthProviders.rolesClaim })
      .from(oauthProviders)
      .where(eq(oauthProviders.id, acc.providerId));
    const provider = providerRows[0];
    if (!provider) continue;

    const claimPath = provider.rolesClaim ?? DEFAULT_ROLES_CLAIM;
    const roles = extractRoles(payload, claimPath);
    await syncUserGroupsFromRoles(database, userId, acc.providerId, roles);
  }
}
