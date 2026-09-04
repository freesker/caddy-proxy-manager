export const MIN_INSTANCE_SYNC_TOKEN_LENGTH = 32;
export const MAX_INSTANCE_SYNC_TOKEN_LENGTH = 512;

export function instanceSyncTokenValidationError(token: unknown): string | null {
  if (typeof token !== "string") {
    return "Sync token must be a string";
  }
  if (token !== token.trim()) {
    return "Sync token must not have leading or trailing whitespace";
  }
  if (token.length < MIN_INSTANCE_SYNC_TOKEN_LENGTH) {
    return `Sync token must be at least ${MIN_INSTANCE_SYNC_TOKEN_LENGTH} characters`;
  }
  if (token.length > MAX_INSTANCE_SYNC_TOKEN_LENGTH) {
    return `Sync token must be at most ${MAX_INSTANCE_SYNC_TOKEN_LENGTH} characters`;
  }
  return null;
}

export function isValidInstanceSyncToken(token: unknown): token is string {
  return instanceSyncTokenValidationError(token) === null;
}

export function assertValidInstanceSyncToken(token: unknown, source = "Sync token"): asserts token is string {
  const error = instanceSyncTokenValidationError(token);
  if (error) {
    throw new Error(
      `${source} is invalid: ${error}. Generate a random token with: openssl rand -hex 32`
    );
  }
}
