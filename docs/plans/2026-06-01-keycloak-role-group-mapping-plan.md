# Keycloak Role → Group Mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Au login Keycloak, refléter les rôles de l'utilisateur dans son appartenance aux groupes CPM via un mapping explicite rôle→groupe, pour piloter l'accès par host du portail Forward Auth.

**Architecture:** Les rôles sont lus depuis l'**ID token OIDC stocké** (chiffré) sur la ligne `accounts`, dans le hook better-auth `databaseHooks.session.create.after` qui s'exécute à chaque login. Une table `oauthRoleMappings` (rôle Keycloak → groupe CPM, scopée par provider) pilote la synchro : les groupes cibles d'un mapping sont 100 % gérés par Keycloak (ajout + retrait). L'accès groupe→host reste l'UI Forward Auth existante.

> **Note de réconciliation avec le spec :** le spec décrivait en primaire un override `getUserInfo` + stash mémoire, avec « persister les rôles sur `accounts` » en fallback. Ce plan réalise le **fallback** (lecture de l'ID token stocké dans `session.create.after`), plus robuste et sans dépendre de l'API interne de better-auth. La config Keycloak requise est identique (mapper avec *Add to ID token: ON*).

> **Contrainte projet importante :** `PRAGMA foreign_keys` n'est **pas** activé (ni prod ni tests). Les `onDelete: cascade` du schéma ne suppriment rien à l'exécution. Toute suppression en cascade doit donc être faite **manuellement** dans le code (cf. Task 4).

**Tech Stack :** Next.js (App Router) · TypeScript · Drizzle ORM (SQLite, bun-sqlite en prod / better-sqlite3 en test) · better-auth `genericOAuth` · Vitest · shadcn/ui.

---

## Structure des fichiers

**Créés :**
- `src/lib/services/oidc-role-sync.ts` — helpers purs + synchro DB (cœur de la feature).
- `src/lib/models/oauth-role-mappings.ts` — CRUD des mappings rôle→groupe + nettoyage manuel.
- `app/(dashboard)/settings/OAuthRoleMappingsSection.tsx` — UI de gestion des mappings.
- `tests/unit/oidc-role-sync.test.ts` — tests des helpers purs.
- `tests/integration/oidc-role-sync.test.ts` — tests de la synchro DB + synchro de session.
- `tests/integration/oauth-role-mappings.test.ts` — tests du modèle + nettoyage manuel.

**Modifiés :**
- `src/lib/db/schema.ts` — table `oauthRoleMappings` + colonne `oauthProviders.rolesClaim`.
- `drizzle/00XX_*.sql` — migration générée.
- `src/lib/models/oauth-providers.ts` — champ `rolesClaim` (type, parse, create, update) + nettoyage des mappings à la suppression du provider.
- `src/lib/models/groups.ts` — nettoyage des mappings à la suppression d'un groupe.
- `src/lib/auth-server.ts` — appel de la synchro dans `session.create.after`.
- `src/lib/config.ts` — lecture `OAUTH_ROLES_CLAIM` (provider env).
- `src/lib/services/oauth-provider-sync.ts` — passage de `rolesClaim` au provider env.
- `app/(dashboard)/settings/OAuthProvidersSection.tsx` — champ « Roles claim » dans le dialogue.
- `app/(dashboard)/settings/actions.ts` — server-actions des mappings + `rolesClaim` dans les actions provider.
- `app/(dashboard)/settings/SettingsClient.tsx` — montage de la nouvelle section + props.
- `app/(dashboard)/settings/page.tsx` — chargement des mappings + groupes.
- `app/(dashboard)/groups/GroupsClient.tsx` — badge « Géré par Keycloak » + verrouillage membres.
- `app/(dashboard)/groups/page.tsx` — calcul des groupes managés.
- `README.md` — section config Keycloak (mapper + mappings).

---

## Task 0 : Prérequis & baseline

**Files:** aucun (vérification d'environnement).

- [ ] **Step 1 : Installer les dépendances**

Run: `bun install`
Expected: installation OK, `node_modules/` présent.

- [ ] **Step 2 : Lancer la suite de tests de référence**

Run: `bun run test`
Expected: la suite passe (vert) — on part d'une base saine.

- [ ] **Step 3 : Vérifier le typecheck de référence**

Run: `bun run typecheck`
Expected: aucun erreur TypeScript.

---

## Task 1 : Schéma — table `oauthRoleMappings` + colonne `rolesClaim`

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create (généré): `drizzle/00XX_*.sql`

- [ ] **Step 1 : Ajouter la colonne `rolesClaim` à `oauthProviders`**

Dans `src/lib/db/schema.ts`, table `oauthProviders`, ajouter la colonne après `userinfoUrl` :

```ts
    userinfoUrl: text("userinfoUrl"),
    rolesClaim: text("rolesClaim"),
    scopes: text("scopes").notNull().default("openid email profile"),
```

- [ ] **Step 2 : Ajouter la table `oauthRoleMappings`**

Dans `src/lib/db/schema.ts`, juste après la définition de `groupMembers` (qui se termine par `);`), ajouter :

```ts
export const oauthRoleMappings = sqliteTable(
  "oauth_role_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    providerId: text("providerId")
      .references(() => oauthProviders.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull(),
    groupId: integer("groupId")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("createdAt").notNull()
  },
  (table) => ({
    mappingUnique: uniqueIndex("oauth_role_mappings_unique").on(
      table.providerId,
      table.role,
      table.groupId
    ),
    providerIdx: index("oauth_role_mappings_provider_idx").on(table.providerId),
    groupIdx: index("oauth_role_mappings_group_idx").on(table.groupId)
  })
);
```

> `onDelete: "cascade"` est conservé pour cohérence avec le reste du schéma, mais ne supprime rien à l'exécution (FK off) — le nettoyage réel est fait en Task 4.

- [ ] **Step 3 : Générer la migration**

Run: `bun run db:generate`
Expected: un nouveau fichier `drizzle/00XX_*.sql` est créé contenant `CREATE TABLE \`oauth_role_mappings\`` et `ALTER TABLE \`oauth_providers\` ADD \`rolesClaim\` text;`, plus le snapshot mis à jour dans `drizzle/meta/`.

- [ ] **Step 4 : Vérifier que la base de test se construit avec la migration**

Run: `bun run test -- tests/integration/oauth-providers.test.ts`
Expected: PASS (la migration s'applique proprement dans `createTestDb`).

- [ ] **Step 5 : Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(oauth): add oauth_role_mappings table and rolesClaim column"
```

---

## Task 2 : Helpers purs — décodage JWT, extraction des rôles, calcul des changements

**Files:**
- Create: `src/lib/services/oidc-role-sync.ts`
- Test: `tests/unit/oidc-role-sync.test.ts`

- [ ] **Step 1 : Écrire les tests des helpers purs**

Créer `tests/unit/oidc-role-sync.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import {
  decodeJwtPayload,
  extractRoles,
  computeMembershipChanges,
  DEFAULT_ROLES_CLAIM,
} from "@/src/lib/services/oidc-role-sync";

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.`;
}

describe("decodeJwtPayload", () => {
  it("decodes the payload of a JWT", () => {
    const jwt = makeJwt({ sub: "abc", realm_access: { roles: ["ops"] } });
    expect(decodeJwtPayload(jwt)).toEqual({
      sub: "abc",
      realm_access: { roles: ["ops"] },
    });
  });

  it("returns null for malformed input", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });
});

describe("extractRoles", () => {
  const claims = {
    realm_access: { roles: ["ops", "admin"] },
    resource_access: { cpm: { roles: ["viewer"] } },
    groups: ["g1", "g2"],
    flat: "not-an-array",
  };

  it("reads the default realm_access.roles path", () => {
    expect(extractRoles(claims, DEFAULT_ROLES_CLAIM)).toEqual(["ops", "admin"]);
  });

  it("reads a nested client-roles path", () => {
    expect(extractRoles(claims, "resource_access.cpm.roles")).toEqual(["viewer"]);
  });

  it("reads a flat array claim", () => {
    expect(extractRoles(claims, "groups")).toEqual(["g1", "g2"]);
  });

  it("returns undefined when the path is missing (claim absent)", () => {
    expect(extractRoles(claims, "realm_access.missing")).toBeUndefined();
    expect(extractRoles({}, DEFAULT_ROLES_CLAIM)).toBeUndefined();
  });

  it("returns undefined when the value is not an array", () => {
    expect(extractRoles(claims, "flat")).toBeUndefined();
  });

  it("returns an empty array when the claim is present but empty", () => {
    expect(extractRoles({ realm_access: { roles: [] } }, DEFAULT_ROLES_CLAIM)).toEqual([]);
  });
});

describe("computeMembershipChanges", () => {
  it("adds target managed groups the user is not in yet", () => {
    const r = computeMembershipChanges({
      managedGroupIds: [1, 2, 3],
      targetGroupIds: [1, 2],
      currentGroupIds: [],
    });
    expect(r.toAdd.sort()).toEqual([1, 2]);
    expect(r.toRemove).toEqual([]);
  });

  it("removes managed groups the user no longer qualifies for", () => {
    const r = computeMembershipChanges({
      managedGroupIds: [1, 2, 3],
      targetGroupIds: [1],
      currentGroupIds: [1, 2],
    });
    expect(r.toAdd).toEqual([]);
    expect(r.toRemove).toEqual([2]);
  });

  it("never touches non-managed groups", () => {
    const r = computeMembershipChanges({
      managedGroupIds: [1, 2],
      targetGroupIds: [1],
      currentGroupIds: [1, 99], // 99 is not managed
    });
    expect(r.toAdd).toEqual([]);
    expect(r.toRemove).toEqual([]);
  });
});
```

- [ ] **Step 2 : Lancer les tests (échec attendu)**

Run: `bun run test -- tests/unit/oidc-role-sync.test.ts`
Expected: FAIL — `Cannot find module '@/src/lib/services/oidc-role-sync'`.

- [ ] **Step 3 : Implémenter les helpers purs**

Créer `src/lib/services/oidc-role-sync.ts` :

```ts
export const DEFAULT_ROLES_CLAIM = "realm_access.roles";

/** Décode le payload d'un JWT (sans vérification — déjà validé en amont par better-auth). */
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
 * Extrait un tableau de rôles depuis un chemin de claim « pointé » (ex. realm_access.roles).
 * - chemin absent              → undefined (claim absent → la synchro sera SKIP)
 * - valeur non-tableau         → undefined (config probablement incorrecte → SKIP)
 * - tableau (même vide)        → string[]
 */
export function extractRoles(
  claims: Record<string, unknown>,
  claimPath: string
): string[] | undefined {
  let cur: unknown = claims;
  for (const part of claimPath.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  if (Array.isArray(cur)) return cur.map((v) => String(v));
  return undefined;
}

/**
 * Calcule les ajouts/retraits d'appartenance, limités aux groupes « managés »
 * (cibles d'au moins un mapping). Les groupes non managés ne sont jamais touchés.
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
```

- [ ] **Step 4 : Lancer les tests (succès attendu)**

Run: `bun run test -- tests/unit/oidc-role-sync.test.ts`
Expected: PASS (tous les cas).

- [ ] **Step 5 : Commit**

```bash
git add src/lib/services/oidc-role-sync.ts tests/unit/oidc-role-sync.test.ts
git commit -m "feat(oauth): add pure helpers for OIDC role extraction and group diffing"
```

---

## Task 3 : Synchro DB — `syncUserGroupsFromRoles`

**Files:**
- Modify: `src/lib/services/oidc-role-sync.ts`
- Test: `tests/integration/oidc-role-sync.test.ts`

- [ ] **Step 1 : Écrire le test d'intégration de la synchro**

Créer `tests/integration/oidc-role-sync.test.ts` :

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { groupMembers, oauthRoleMappings } from "@/src/lib/db/schema";
import { eq } from "drizzle-orm";
import { syncUserGroupsFromRoles } from "@/src/lib/services/oidc-role-sync";

let db: TestDb;
const PROVIDER = "prov-1";

beforeEach(() => {
  db = createTestDb();
});

async function memberGroupIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  return rows.map((r) => r.groupId).sort((a, b) => a - b);
}

async function addMapping(role: string, groupId: number) {
  await db.insert(oauthRoleMappings).values({
    providerId: PROVIDER,
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
    await db.insert(oauthRoleMappings).values({
      providerId: "other", role: "ops", groupId: 2, createdAt: new Date().toISOString(),
    });
    await syncUserGroupsFromRoles(db, 10, PROVIDER, ["ops"]);
    expect(await memberGroupIds(10)).toEqual([1]); // group 2 (other provider) untouched
  });
});
```

- [ ] **Step 2 : Lancer le test (échec attendu)**

Run: `bun run test -- tests/integration/oidc-role-sync.test.ts`
Expected: FAIL — `syncUserGroupsFromRoles is not a function` / import introuvable.

- [ ] **Step 3 : Implémenter `syncUserGroupsFromRoles`**

Ajouter en haut de `src/lib/services/oidc-role-sync.ts` les imports, puis la fonction à la fin du fichier :

```ts
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { and, eq, inArray } from "drizzle-orm";
import { groupMembers, oauthRoleMappings } from "../db/schema";

/** Accepte aussi bien le driver bun-sqlite (prod) que better-sqlite3 (tests) — tous deux synchrones. */
export type SyncDb = BaseSQLiteDatabase<"sync", unknown>;
```

```ts
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
```

- [ ] **Step 4 : Lancer le test + typecheck**

Run: `bun run test -- tests/integration/oidc-role-sync.test.ts && bun run typecheck`
Expected: PASS et aucun erreur TS. Si TS se plaint du type `SyncDb` au point d'appel de test, c'est que `createTestDb()` n'est pas assignable — dans ce cas, élargir : `export type SyncDb = BaseSQLiteDatabase<"sync", any>;`.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/services/oidc-role-sync.ts tests/integration/oidc-role-sync.test.ts
git commit -m "feat(oauth): sync user group membership from Keycloak roles"
```

---

## Task 4 : Modèle des mappings + nettoyage manuel (provider/groupe supprimé)

**Files:**
- Create: `src/lib/models/oauth-role-mappings.ts`
- Modify: `src/lib/models/oauth-providers.ts` (nettoyage à la suppression)
- Modify: `src/lib/models/groups.ts` (nettoyage à la suppression)
- Test: `tests/integration/oauth-role-mappings.test.ts`

- [ ] **Step 1 : Écrire les tests du modèle + nettoyage**

Créer `tests/integration/oauth-role-mappings.test.ts` :

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { oauthRoleMappings } from "@/src/lib/db/schema";
import { eq } from "drizzle-orm";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
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
```

- [ ] **Step 2 : Lancer le test (échec attendu)**

Run: `bun run test -- tests/integration/oauth-role-mappings.test.ts`
Expected: FAIL — unique index OK mais imports `deleteMappingsForProvider` / `deleteMappingsForGroup` introuvables.

- [ ] **Step 3 : Implémenter le modèle des mappings**

Créer `src/lib/models/oauth-role-mappings.ts` :

```ts
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

/** Nettoyage manuel — les FK ne cascadent pas (PRAGMA foreign_keys off). DB injectée pour les tests. */
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
```

- [ ] **Step 4 : Brancher le nettoyage à la suppression d'un provider**

Dans `src/lib/models/oauth-providers.ts`, dans `deleteOAuthProvider`, juste avant la ligne `await db.delete(oauthProviders).where(eq(oauthProviders.id, id));`, ajouter :

```ts
  const { deleteMappingsForProvider } = await import("./oauth-role-mappings");
  await deleteMappingsForProvider(db, id);
```

- [ ] **Step 5 : Brancher le nettoyage à la suppression d'un groupe**

Dans `src/lib/models/groups.ts`, dans `deleteGroup`, juste avant `await db.delete(groups).where(eq(groups.id, id));`, ajouter :

```ts
  const { deleteMappingsForGroup } = await import("./oauth-role-mappings");
  await deleteMappingsForGroup(db, id);
```

- [ ] **Step 6 : Lancer le test + typecheck**

Run: `bun run test -- tests/integration/oauth-role-mappings.test.ts && bun run typecheck`
Expected: PASS et aucun erreur TS.

- [ ] **Step 7 : Commit**

```bash
git add src/lib/models/oauth-role-mappings.ts src/lib/models/oauth-providers.ts src/lib/models/groups.ts tests/integration/oauth-role-mappings.test.ts
git commit -m "feat(oauth): role-mapping model with manual cleanup on provider/group delete"
```

---

## Task 5 : Propagation de `rolesClaim` sur le provider

**Files:**
- Modify: `src/lib/models/oauth-providers.ts`
- Modify: `src/lib/config.ts`
- Modify: `src/lib/services/oauth-provider-sync.ts`
- Modify: `app/(dashboard)/settings/OAuthProvidersSection.tsx`
- Modify: `app/(dashboard)/settings/actions.ts`

- [ ] **Step 1 : Ajouter `rolesClaim` au type et au parsing du modèle provider**

Dans `src/lib/models/oauth-providers.ts` :

1. Dans `type OAuthProvider`, ajouter après `scopes: string;` :
```ts
  rolesClaim: string | null;
```
2. Dans `parseDbProvider`, ajouter après `scopes: row.scopes,` :
```ts
    rolesClaim: row.rolesClaim,
```
3. Dans `createOAuthProvider` (param `data`), ajouter après `scopes?: string;` :
```ts
  rolesClaim?: string | null;
```
   puis dans le `.values({...})`, après `scopes: data.scopes ?? "openid email profile",` :
```ts
      rolesClaim: data.rolesClaim ?? null,
```
4. Dans `updateOAuthProvider` (param `data: Partial<{...}>`), ajouter après `scopes: string;` :
```ts
    rolesClaim: string | null;
```
   puis dans le corps, après le bloc `if (data.scopes !== undefined) updates.scopes = data.scopes;` :
```ts
  if (data.rolesClaim !== undefined) updates.rolesClaim = data.rolesClaim;
```

- [ ] **Step 2 : Lire `OAUTH_ROLES_CLAIM` dans la config**

Dans `src/lib/config.ts`, repérer l'objet `oauth` (où sont lus `clientId`, `issuer`, etc.) et ajouter une propriété calquée sur les autres champs optionnels, par ex. :

```ts
    rolesClaim: process.env.OAUTH_ROLES_CLAIM || undefined,
```

(placer la ligne à côté de `issuer`/`userinfoUrl` dans le même bloc `oauth`).

- [ ] **Step 3 : Propager `rolesClaim` au provider env**

Dans `src/lib/services/oauth-provider-sync.ts`, dans l'objet `data`, ajouter après `userinfoUrl: config.oauth.userinfoUrl ?? null,` :

```ts
    rolesClaim: config.oauth.rolesClaim ?? null,
```

- [ ] **Step 4 : Ajouter le champ « Roles claim » au dialogue provider**

Dans `app/(dashboard)/settings/OAuthProvidersSection.tsx` :

1. Dans `type FormData`, ajouter après `userinfoUrl: string;` :
```ts
  rolesClaim: string;
```
2. Dans `emptyForm`, ajouter après `userinfoUrl: "",` :
```ts
  rolesClaim: "",
```
3. Dans `openEditDialog`, dans le `setForm({...})`, ajouter après `userinfoUrl: provider.userinfoUrl ?? "",` :
```ts
      rolesClaim: provider.rolesClaim ?? "",
```
4. Dans `handleSave`, branche `editingProvider` (`updateOAuthProviderAction`), ajouter après `userinfoUrl: form.userinfoUrl.trim() || null,` :
```ts
          rolesClaim: form.rolesClaim.trim() || null,
```
5. Dans `handleSave`, branche `else` (`createOAuthProviderAction`), ajouter après `userinfoUrl: form.userinfoUrl.trim() || undefined,` :
```ts
          rolesClaim: form.rolesClaim.trim() || undefined,
```
6. Dans le JSX, juste après le bloc du champ `oauth-scopes` (la `<div>` se terminant après l'Input des scopes), ajouter :
```tsx
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oauth-roles-claim">Roles claim (RBAC)</Label>
              <Input
                id="oauth-roles-claim"
                value={form.rolesClaim}
                onChange={(e) => updateField("rolesClaim", e.target.value)}
                placeholder="realm_access.roles"
                className="h-8 text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Chemin du claim contenant les rôles dans l&apos;ID token Keycloak (laisser vide = realm_access.roles).
              </p>
            </div>
```

- [ ] **Step 5 : Accepter `rolesClaim` dans les server-actions provider**

Dans `app/(dashboard)/settings/actions.ts` :

1. Dans `createOAuthProviderAction`, étendre le type `data` : ajouter après `userinfoUrl?: string;` :
```ts
  rolesClaim?: string;
```
2. Dans `updateOAuthProviderAction`, étendre le `Partial<{...}>` : ajouter après `userinfoUrl: string | null;` :
```ts
    rolesClaim: string | null;
```

(les deux actions passent déjà `...data` / `data` au modèle, aucune autre modification nécessaire.)

- [ ] **Step 6 : Vérifier typecheck + tests**

Run: `bun run typecheck && bun run test -- tests/integration/oauth-providers.test.ts`
Expected: aucun erreur TS, tests provider toujours verts.

- [ ] **Step 7 : Commit**

```bash
git add src/lib/models/oauth-providers.ts src/lib/config.ts src/lib/services/oauth-provider-sync.ts "app/(dashboard)/settings/OAuthProvidersSection.tsx" "app/(dashboard)/settings/actions.ts"
git commit -m "feat(oauth): add per-provider rolesClaim (UI, model, env)"
```

---

## Task 6 : Synchro à la connexion — `syncRolesForUserSession` + câblage better-auth

**Files:**
- Modify: `src/lib/services/oidc-role-sync.ts`
- Modify: `src/lib/auth-server.ts`
- Test: `tests/integration/oidc-role-sync.test.ts`

- [ ] **Step 1 : Écrire le test d'intégration de la synchro de session**

Ajouter à `tests/integration/oidc-role-sync.test.ts` (nouveaux imports + nouveau bloc `describe`) :

```ts
import { accounts, oauthProviders } from "@/src/lib/db/schema";
import { encryptSecret } from "@/src/lib/secret";
import { randomUUID } from "node:crypto";
import { syncRolesForUserSession } from "@/src/lib/services/oidc-role-sync";

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
      scopes: "openid", rolesClaim: null, // → default realm_access.roles
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
      userId: 10, accountId: "kc-user-1", providerId,
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
    // credential account → ignored
    await db.insert(accounts).values({
      userId: 10, accountId: "10", providerId: "credential",
      password: "hash", createdAt: now, updatedAt: now,
    });
    // expired OAuth token → skipped (no membership change)
    const expired = makeIdToken({
      sub: "kc-user-1", exp: Math.floor(Date.now() / 1000) - 10,
      realm_access: { roles: ["ops"] },
    });
    await db.insert(accounts).values({
      userId: 10, accountId: "kc-user-1", providerId,
      idToken: encryptSecret(expired), createdAt: now, updatedAt: now,
    });

    await syncRolesForUserSession(db, 10);
    expect(await memberGroupIds(10)).toEqual([]);
  });
});
```

- [ ] **Step 2 : Lancer le test (échec attendu)**

Run: `bun run test -- tests/integration/oidc-role-sync.test.ts`
Expected: FAIL — `syncRolesForUserSession` introuvable.

- [ ] **Step 3 : Implémenter `syncRolesForUserSession`**

Dans `src/lib/services/oidc-role-sync.ts`, ajouter aux imports :

```ts
import { accounts, oauthProviders } from "../db/schema";
import { decryptSecret, isEncryptedSecret } from "../secret";
```

puis ajouter la fonction :

```ts
/**
 * Synchronise les groupes d'un utilisateur à partir des rôles présents dans les
 * ID tokens OIDC stockés sur ses comptes. Appelée à chaque login (session.create.after).
 * Les tokens expirés sont ignorés pour éviter de réappliquer des rôles périmés lors
 * d'un login non-OIDC (ex. credentials).
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
    if (exp > 0 && exp * 1000 < Date.now()) continue; // token périmé → ignore

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
```

- [ ] **Step 4 : Lancer le test (succès attendu)**

Run: `bun run test -- tests/integration/oidc-role-sync.test.ts`
Expected: PASS (tous les blocs).

- [ ] **Step 5 : Câbler la synchro dans better-auth**

Dans `src/lib/auth-server.ts`, dans `databaseHooks.session.create.after`, après le bloc `try { ... createAuditEvent ... } catch {}` existant, ajouter un second bloc :

```ts
            try {
              const { syncRolesForUserSession } = await import("./services/oidc-role-sync");
              const database = (await import("./db")).default;
              const uid =
                typeof session.userId === "string" ? Number(session.userId) : session.userId;
              await syncRolesForUserSession(database, uid);
            } catch (e) {
              console.warn("[auth-server] role→group sync failed", e);
            }
```

- [ ] **Step 6 : Vérifier typecheck**

Run: `bun run typecheck`
Expected: aucun erreur TS. (Si `(await import("./db")).default` n'est pas assignable à `SyncDb`, élargir `SyncDb` en `BaseSQLiteDatabase<"sync", any>` comme indiqué en Task 3.)

- [ ] **Step 7 : Commit**

```bash
git add src/lib/services/oidc-role-sync.ts src/lib/auth-server.ts tests/integration/oidc-role-sync.test.ts
git commit -m "feat(oauth): sync Keycloak roles to groups on every login"
```

---

## Task 7 : Server-actions des mappings

**Files:**
- Modify: `app/(dashboard)/settings/actions.ts`

- [ ] **Step 1 : Ajouter les actions list/create/delete des mappings**

Dans `app/(dashboard)/settings/actions.ts`, après `deleteOAuthProviderAction`, ajouter :

```ts
export async function getRoleMappingsAction() {
  await requireAdmin();
  const { listRoleMappings } = await import("@/src/lib/models/oauth-role-mappings");
  return listRoleMappings();
}

export async function createRoleMappingAction(data: {
  providerId: string;
  role: string;
  groupId: number;
}) {
  const session = await requireAdmin();
  const { createRoleMapping } = await import("@/src/lib/models/oauth-role-mappings");
  const mapping = await createRoleMapping(data);
  const { createAuditEvent } = await import("@/src/lib/models/audit");
  await createAuditEvent({
    userId: Number(session.user.id),
    action: "oauth_role_mapping_created",
    entityType: "oauth_role_mapping",
    entityId: mapping.id,
    summary: `Mapped role "${data.role}" to group ${data.groupId}`,
    data: JSON.stringify(data),
  });
  revalidatePath("/settings");
  revalidatePath("/groups");
  return mapping;
}

export async function deleteRoleMappingAction(id: number) {
  const session = await requireAdmin();
  const { deleteRoleMapping } = await import("@/src/lib/models/oauth-role-mappings");
  await deleteRoleMapping(id);
  const { createAuditEvent } = await import("@/src/lib/models/audit");
  await createAuditEvent({
    userId: Number(session.user.id),
    action: "oauth_role_mapping_deleted",
    entityType: "oauth_role_mapping",
    entityId: id,
    summary: `Deleted role mapping ${id}`,
    data: JSON.stringify({ id }),
  });
  revalidatePath("/settings");
  revalidatePath("/groups");
}
```

- [ ] **Step 2 : Vérifier typecheck**

Run: `bun run typecheck`
Expected: aucun erreur TS.

- [ ] **Step 3 : Commit**

```bash
git add "app/(dashboard)/settings/actions.ts"
git commit -m "feat(oauth): server actions for role-to-group mappings"
```

---

## Task 8 : UI Settings — section « Role Mappings »

**Files:**
- Create: `app/(dashboard)/settings/OAuthRoleMappingsSection.tsx`
- Modify: `app/(dashboard)/settings/page.tsx`
- Modify: `app/(dashboard)/settings/SettingsClient.tsx`

- [ ] **Step 1 : Créer le composant de section**

Créer `app/(dashboard)/settings/OAuthRoleMappingsSection.tsx` :

```tsx
"use client";

import { useState } from "react";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createRoleMappingAction, deleteRoleMappingAction } from "./actions";

type RoleMapping = {
  id: number;
  providerId: string;
  role: string;
  groupId: number;
};

type ProviderRef = { id: string; name: string };
type GroupRef = { id: number; name: string };

interface Props {
  initialMappings: RoleMapping[];
  providers: ProviderRef[];
  groups: GroupRef[];
}

export default function OAuthRoleMappingsSection({
  initialMappings,
  providers,
  groups,
}: Props) {
  const [mappings, setMappings] = useState(initialMappings);
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [role, setRole] = useState("");
  const [groupId, setGroupId] = useState<string>(groups[0]?.id ? String(groups[0].id) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? `#${id}`;

  async function handleAdd() {
    if (!providerId || !role.trim() || !groupId) {
      setError("Provider, role, and group are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createRoleMappingAction({
        providerId,
        role: role.trim(),
        groupId: Number(groupId),
      });
      setMappings((prev) => [...prev, created]);
      setRole("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add mapping");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteRoleMappingAction(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error("Failed to delete mapping:", err);
    }
  }

  if (providers.length === 0) {
    return (
      <Alert className="border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400">
        <AlertDescription>
          Add an OAuth provider first to configure role mappings.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Map Keycloak roles to CPM groups. Membership of mapped groups is recalculated from the
        user&apos;s roles at each login (add and remove). Grant those groups access to hosts on the
        Forward Auth page.
      </p>

      {mappings.length === 0 && (
        <Alert className="border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400">
          <AlertDescription>No role mappings configured yet.</AlertDescription>
        </Alert>
      )}

      {mappings.map((m) => (
        <div
          key={m.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2"
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{providerName(m.providerId)}</span>
            <code className="font-mono">{m.role}</code>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{groupName(m.groupId)}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive"
            onClick={() => handleDelete(m.id)}
            title="Delete mapping"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        {providers.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger className="h-8 text-sm w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rm-role" className="text-xs">
            Keycloak role
          </Label>
          <Input
            id="rm-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. ops"
            className="h-8 text-sm font-mono w-44"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Group</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="h-8 text-sm w-44">
              <SelectValue placeholder="Select group" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={handleAdd} disabled={saving || groups.length === 0}>
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>
      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Create a group first on the Groups page.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Charger mappings + groupes côté page Settings**

Dans `app/(dashboard)/settings/page.tsx` :

1. Ajouter les imports en haut :
```ts
import { listRoleMappings } from "@/src/lib/models/oauth-role-mappings";
import { listGroups } from "@/src/lib/models/groups";
```
2. Ajouter `listRoleMappings()` et `listGroups()` au `Promise.all` (et déstructurer) — remplacer la ligne `listOAuthProviders(),` et la fin du tableau par :
```ts
    listOAuthProviders(),
    listRoleMappings(),
    listGroups(),
  ]);
```
   et le `const [ ... oauthProviders] = await Promise.all([` devient :
```ts
  const [general, dnsProvider, authentik, metrics, logging, dns, upstreamDnsResolution, instanceMode, globalGeoBlock, oauthProviders, roleMappings, allGroups] = await Promise.all([
```
3. Construire des refs légères avant le `return` :
```ts
  const roleMappingProviders = oauthProviders.map((p) => ({ id: p.id, name: p.name }));
  const roleMappingGroups = allGroups.map((g) => ({ id: g.id, name: g.name }));
```
4. Passer les nouvelles props à `<SettingsClient ... />`, après `oauthProviders={oauthProviders}` :
```tsx
      roleMappings={roleMappings}
      roleMappingProviders={roleMappingProviders}
      roleMappingGroups={roleMappingGroups}
```

- [ ] **Step 3 : Câbler la section dans `SettingsClient`**

Dans `app/(dashboard)/settings/SettingsClient.tsx` :

1. Importer le composant (près de `import OAuthProvidersSection from "./OAuthProvidersSection";`) :
```ts
import OAuthRoleMappingsSection from "./OAuthRoleMappingsSection";
```
2. Étendre le type des props du composant `SettingsClient` (où figurent `oauthProviders: OAuthProvider[];` et `baseUrl: string;`), ajouter :
```ts
  roleMappings: { id: number; providerId: string; role: string; groupId: number }[];
  roleMappingProviders: { id: string; name: string }[];
  roleMappingGroups: { id: number; name: string }[];
```
3. Déstructurer ces props dans la signature du composant (à côté de `oauthProviders,` et `baseUrl,`) :
```ts
  roleMappings,
  roleMappingProviders,
  roleMappingGroups,
```
4. Repérer le bloc `<OAuthSection oauthProviders={oauthProviders} baseUrl={baseUrl} />` et, juste après ce composant, ajouter une nouvelle carte/section en suivant le même style d'enrobage que les sections voisines (réutiliser le wrapper de section local ; si les sections sont de simples blocs, ajouter) :
```tsx
                <div className="rounded-lg border bg-card p-4 sm:p-6">
                  <h3 className="text-sm font-semibold mb-1">Keycloak Role Mappings</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Map Keycloak roles to CPM groups for forward-auth access.
                  </p>
                  <OAuthRoleMappingsSection
                    initialMappings={roleMappings}
                    providers={roleMappingProviders}
                    groups={roleMappingGroups}
                  />
                </div>
```
   > Adapter l'enrobage (`<div>`/wrapper) au pattern exact utilisé par `OAuthSection` voisin pour rester cohérent visuellement.

- [ ] **Step 4 : Vérifier le rendu (typecheck + build de la page)**

Run: `bun run typecheck`
Expected: aucun erreur TS.

Run: `bun run lint`
Expected: pas d'erreur de lint sur les fichiers modifiés.

- [ ] **Step 5 : Commit**

```bash
git add "app/(dashboard)/settings/OAuthRoleMappingsSection.tsx" "app/(dashboard)/settings/page.tsx" "app/(dashboard)/settings/SettingsClient.tsx"
git commit -m "feat(oauth): Settings UI to manage Keycloak role-to-group mappings"
```

---

## Task 9 : UI Groups — badge « Géré par Keycloak » + verrouillage

**Files:**
- Modify: `app/(dashboard)/groups/page.tsx`
- Modify: `app/(dashboard)/groups/GroupsClient.tsx`

- [ ] **Step 1 : Calculer les groupes managés côté page**

Dans `app/(dashboard)/groups/page.tsx` :

1. Ajouter l'import :
```ts
import { listManagedGroupIds } from "@/src/lib/models/oauth-role-mappings";
```
2. Ajouter `listManagedGroupIds()` au `Promise.all` :
```ts
  const [allGroups, allUsers, managedGroupIds] = await Promise.all([
    listGroups(),
    listUsers(),
    listManagedGroupIds(),
  ]);
```
3. Passer la prop au client :
```tsx
  return <GroupsClient groups={allGroups} users={userList} managedGroupIds={managedGroupIds} />;
```

- [ ] **Step 2 : Badge + verrouillage dans `GroupsClient`**

Dans `app/(dashboard)/groups/GroupsClient.tsx` :

1. Étendre `type Props` :
```ts
type Props = {
  groups: Group[];
  users: UserEntry[];
  managedGroupIds: number[];
};
```
2. Mettre à jour la signature et créer un Set :
```ts
export default function GroupsClient({ groups, users, managedGroupIds }: Props) {
  const managed = new Set(managedGroupIds);
```
3. Dans le `.map((group) => {`, calculer un flag juste après `const available = getAvailableUsers(group);` :
```ts
          const isManaged = managed.has(group.id);
```
4. Ajouter le badge à côté du nom : remplacer le bloc titre
```tsx
                  <div>
                    <h3 className="font-semibold text-base">{group.name}</h3>
                    {group.description && (
                      <p className="text-sm text-muted-foreground">{group.description}</p>
                    )}
                  </div>
```
   par
```tsx
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-base">{group.name}</h3>
                      {isManaged && (
                        <span className="text-xs rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5">
                          Géré par Keycloak
                        </span>
                      )}
                    </div>
                    {group.description && (
                      <p className="text-sm text-muted-foreground">{group.description}</p>
                    )}
                  </div>
```
5. Verrouiller le bouton « Add member » : sur le `<Button ... title="Add member">`, ajouter `disabled={isManaged}` et un titre conditionnel :
```tsx
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={isManaged}
                      onClick={() =>
                        setAddMemberGroupId(addMemberGroupId === group.id ? null : group.id)
                      }
                      title={isManaged ? "Appartenance pilotée par les rôles Keycloak" : "Add member"}
                    >
                      <UserPlus className="h-4 w-4" />
                    </Button>
```
6. Verrouiller le retrait de membre : sur le `<Button ... title="Remove member">` (dans la liste des membres), ajouter `disabled={isManaged}` et un titre conditionnel :
```tsx
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            disabled={isManaged}
                            onClick={async () => {
                              await removeGroupMemberAction(group.id, member.userId);
                              router.refresh();
                            }}
                            title={isManaged ? "Appartenance pilotée par les rôles Keycloak" : "Remove member"}
                          >
                            <UserMinus className="h-3 w-3" />
                          </Button>
```

- [ ] **Step 3 : Vérifier typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: aucun erreur.

- [ ] **Step 4 : Commit**

```bash
git add "app/(dashboard)/groups/page.tsx" "app/(dashboard)/groups/GroupsClient.tsx"
git commit -m "feat(groups): badge and lock for Keycloak-managed groups"
```

---

## Task 10 : Documentation Keycloak (README)

**Files:**
- Modify: `README.md`

- [ ] **Step 1 : Ajouter une sous-section sous « OAuth Authentication »**

Dans `README.md`, après la section OAuth existante, ajouter :

```markdown
### Restricting host access by Keycloak role

CPM can drive Forward Auth host access from Keycloak roles by syncing roles to CPM groups at login.

1. **Expose roles in the ID token (Keycloak).** On your CPM client, add a protocol mapper:
   - Type **User Realm Role** (or **User Client Role** for client roles)
   - **Multivalued**: ON
   - **Token Claim Name**: `realm_access.roles`
   - **Add to ID token**: ON, **Add to userinfo**: ON

   Assign realm/client roles to your users.

2. **(Optional) Set the roles claim path in CPM.** In *Settings → OAuth Providers*, edit the
   provider and set **Roles claim** if it differs from the default `realm_access.roles`
   (e.g. `resource_access.<client>.roles`).

3. **Create the mappings.** In *Settings → Keycloak Role Mappings*, map each Keycloak role to a CPM
   group. Mapped groups are recalculated from the user's roles at every login (membership is added
   **and** removed) — do not edit their membership by hand (they are locked on the Groups page).

4. **Grant group access to hosts.** On a Forward-Auth-protected host, grant access to the mapped
   group(s). Users with the matching Keycloak role get access; users who lose the role lose access
   at their next login.

> If the roles claim is absent from the ID token (mapper not configured), CPM skips the sync and
> logs a warning rather than removing everyone from mapped groups.
```

- [ ] **Step 2 : Commit**

```bash
git add README.md
git commit -m "docs: document Keycloak role-based host access"
```

---

## Task 11 (optionnel) : Test E2E via Dex

> À implémenter seulement si l'on veut une couverture bout-en-bout. Réutilise le harness Dex
> (`tests/dex/config.yml`, `tests/e2e/functional/forward-auth-oauth.spec.ts`). Dex peut émettre un
> claim `groups` ; configurer le provider avec `rolesClaim=groups`, mapper un groupe Dex → groupe
> CPM → host protégé, puis asserter accès accordé/refusé. Non détaillé ici ; les Tasks 1-10
> fournissent déjà une couverture unitaire + intégration des comportements critiques.

---

## Vérification finale

- [ ] **Suite complète**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: tout vert.

- [ ] **Revue manuelle rapide**
  - Settings → ajouter un mapping rôle→groupe, vérifier l'apparition + suppression.
  - Groups → le groupe ciblé affiche « Géré par Keycloak » et les boutons membres sont grisés.
  - Login Keycloak d'un utilisateur ayant le rôle → il rejoint le groupe ; accès au host accordé.
