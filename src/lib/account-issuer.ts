import {
  createLocalAccountIssuer,
  createOAuthAccountIssuer,
} from "better-auth/db";

/** Better Auth's stable namespace for password-backed accounts. */
export const CREDENTIAL_ACCOUNT_ISSUER = createLocalAccountIssuer("credential");

/**
 * Resolve the identity namespace used for a configured OAuth provider.
 *
 * Prefer the operator-configured issuer when present. Providers without an
 * issuer stay isolated by Better Auth's synthetic, URL-encoded provider
 * namespace so they cannot collide with local authentication methods.
 */
export function resolveOAuthAccountIssuer(
  providerId: string,
  configuredIssuer?: string | null
): string {
  const issuer = configuredIssuer?.trim();
  return issuer || createOAuthAccountIssuer(providerId);
}
