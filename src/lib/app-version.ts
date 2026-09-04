// Application version, inlined at build time by next.config.mjs.
// next.config.mjs resolves it from the APP_VERSION build arg (set by CI from
// the git tag for release builds) and falls back to the package.json version.
export const APP_VERSION: string =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "unknown";

export function formatAppVersion(version: string = APP_VERSION): string {
  return `v${version}`;
}
