import type { OAuthProvider } from "./models/oauth-providers";

/**
 * OAuth provider data that is safe to serialize to React clients and ordinary
 * API responses. Use an explicit allowlist so future server-side fields do not
 * cross the browser boundary automatically.
 */
export type OAuthProviderView = {
  id: string;
  name: string;
  type: string;
  clientId: string;
  hasClientSecret: boolean;
  issuer: string | null;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  userinfoUrl: string | null;
  scopes: string;
  autoLink: boolean;
  enabled: boolean;
  /** JSON path of the IdP claim holding the roles synced to CPM groups. */
  rolesClaim: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export function toOAuthProviderView(provider: OAuthProvider): OAuthProviderView {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    clientId: provider.clientId,
    hasClientSecret: provider.clientSecret.length > 0,
    issuer: provider.issuer,
    authorizationUrl: provider.authorizationUrl,
    tokenUrl: provider.tokenUrl,
    userinfoUrl: provider.userinfoUrl,
    scopes: provider.scopes,
    autoLink: provider.autoLink,
    enabled: provider.enabled,
    rolesClaim: provider.rolesClaim,
    source: provider.source,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

/** Better Auth 1.7 uses the standard social-provider callback route. */
export function oauthCallbackUrl(baseUrl: string, providerId: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${normalizedBaseUrl}/api/auth/callback/${encodeURIComponent(providerId)}`;
}

/**
 * Preserve the stored secret unless the administrator explicitly supplies a
 * replacement. Omitting the property is important: an empty string would
 * otherwise rotate the provider to an unusable credential.
 */
export function withOAuthClientSecretRotation<T extends object>(
  update: T,
  replacement: string | undefined
): T & { clientSecret?: string } {
  const clientSecret = replacement?.trim();
  return clientSecret ? { ...update, clientSecret } : update;
}
