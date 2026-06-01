import db from "../db";
import { oauthRoleMappings } from "../db/schema";
import { eq } from "drizzle-orm";
import type { SyncDb } from "../services/oidc-role-sync";

export type OAuthRoleMapping = {
  id: number;
  providerId: string;
  role: string;
  groupId: number;
  createdAt: string;
};

export async function listRoleMappings(): Promise<OAuthRoleMapping[]> {
  return db
    .select()
    .from(oauthRoleMappings)
    .orderBy(oauthRoleMappings.providerId, oauthRoleMappings.role);
}

export async function createRoleMapping(data: {
  providerId: string;
  role: string;
  groupId: number;
}): Promise<OAuthRoleMapping> {
  const [row] = await db
    .insert(oauthRoleMappings)
    .values({
      providerId: data.providerId,
      role: data.role.trim(),
      groupId: data.groupId,
      createdAt: new Date().toISOString(),
    })
    .returning();
  return row;
}

export async function deleteRoleMapping(id: number): Promise<void> {
  await db.delete(oauthRoleMappings).where(eq(oauthRoleMappings.id, id));
}

/** Liste des groupId cibles d'au moins un mapping (groupes « managés »). */
export async function listManagedGroupIds(): Promise<number[]> {
  const rows = await db
    .select({ groupId: oauthRoleMappings.groupId })
    .from(oauthRoleMappings);
  return [...new Set(rows.map((r) => r.groupId))];
}

/** Manual cleanup — FKs don't cascade in prod (bun:sqlite). DB injected for tests. */
export async function deleteMappingsForProvider(
  database: SyncDb,
  providerId: string
): Promise<void> {
  await database
    .delete(oauthRoleMappings)
    .where(eq(oauthRoleMappings.providerId, providerId));
}

export async function deleteMappingsForGroup(
  database: SyncDb,
  groupId: number
): Promise<void> {
  await database.delete(oauthRoleMappings).where(eq(oauthRoleMappings.groupId, groupId));
}
