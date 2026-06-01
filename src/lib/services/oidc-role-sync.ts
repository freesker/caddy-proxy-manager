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
