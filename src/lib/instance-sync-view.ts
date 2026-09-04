import type { EnvSlaveInstance } from "./instance-sync";

export type EnvSlaveInstanceView = Pick<EnvSlaveInstance, "name" | "url">;

/**
 * Environment-configured sync tokens are server-only credentials. Keep the
 * browser payload as an explicit allowlist so new server-side fields cannot
 * start crossing the React Server Component boundary by accident.
 */
export function toEnvSlaveInstanceView(
  instance: EnvSlaveInstance
): EnvSlaveInstanceView {
  return {
    name: instance.name,
    url: instance.url,
  };
}
