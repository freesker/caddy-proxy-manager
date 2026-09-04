import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

/**
 * Internal proof header injected by generated Caddy routes before they proxy a
 * forward-auth callback/verification request to CPM.  Forwarded host/protocol
 * headers alone are not trustworthy because the Next.js origin may be reachable
 * directly and clients can forge them there.
 */
export const FORWARD_AUTH_PROXY_PROOF_HEADER = "X-CPM-Forward-Auth-Proof";

const PROOF_CONTEXT = "cpm-forward-auth-proxy-proof:v1";

/**
 * Derive a purpose-specific key instead of placing SESSION_SECRET itself in the
 * generated Caddy configuration.  Administrators who can read Caddy's config
 * are already trusted with the forward-auth control plane.
 */
export function getForwardAuthProxyProof(): string {
  return createHmac("sha256", config.sessionSecret)
    .update(PROOF_CONTEXT)
    .digest("hex");
}

function hasValidProxyProof(headers: Headers): boolean {
  const supplied = headers.get(FORWARD_AUTH_PROXY_PROOF_HEADER);
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;

  const expected = Buffer.from(getForwardAuthProxyProof(), "hex");
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Return the exact, normalized external origin vouched for by Caddy.  Scheme,
 * hostname, and non-default port are all part of URL.origin.  No Host fallback
 * is allowed: a direct request must never be able to manufacture an audience.
 */
export function getTrustedForwardAuthOrigin(headers: Headers): string | null {
  if (!hasValidProxyProof(headers)) return null;

  const forwardedProto = headers.get("x-forwarded-proto")?.trim().toLowerCase();
  const forwardedHost = headers.get("x-forwarded-host")?.trim();
  if (
    (forwardedProto !== "http" && forwardedProto !== "https") ||
    !forwardedHost ||
    forwardedHost.includes(",") ||
    /[\r\n]/.test(forwardedHost)
  ) {
    return null;
  }

  try {
    const parsed = new URL(`${forwardedProto}://${forwardedHost}`);
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
