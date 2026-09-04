import { NextRequest, NextResponse } from "next/server";
import {
  validateForwardAuthSession,
  checkHostAccess,
  resolveForwardAuthAudience,
} from "@/src/lib/models/forward-auth";
import { getUserById } from "@/src/lib/models/user";
import { getGroupsForUser } from "@/src/lib/models/groups";
import { getTrustedForwardAuthOrigin } from "@/src/lib/forward-auth-trust";

const COOKIE_NAME = "_cpm_fa";

/**
 * HTTP header values must be ISO-8859-1, and this runtime (undici) only accepts
 * printable ASCII + tab — even Latin-1 accents are rejected. Identity values coming
 * from an IdP can contain accented or non-Latin characters (e.g. "Clement Petrault"
 * spelled with accents), which would otherwise make `new NextResponse` throw and
 * turn this Caddy subrequest into a 500.
 *
 * Transliterate accented Latin letters to their ASCII base ("Clement" with accents
 * becomes "Clement") for readable usernames downstream, then percent-encode anything
 * still outside printable ASCII (CJK, emoji, ...) so the value stays safe. The `u`
 * flag keeps surrogate pairs intact so encodeURIComponent never sees a lone surrogate.
 */
function toHeaderValue(value: string): string {
  return value
    .normalize("NFKD") // decompose accented letters into base + combining mark
    .replace(/\p{Mn}/gu, "") // strip the combining diacritical marks
    .replace(/[^\x20-\x7E]/gu, (ch) => encodeURIComponent(ch));
}

/**
 * Forward auth verify endpoint — called by Caddy as a subrequest.
 * Returns 200 + user headers on success, 401 on failure.
 */
export async function GET(request: NextRequest) {
  try {
    // Never trust X-Forwarded-* from a client reaching Next.js directly.  Only
    // generated Caddy routes know the purpose-derived proof value.
    const requestOrigin = getTrustedForwardAuthOrigin(request.headers);
    const audience = requestOrigin
      ? await resolveForwardAuthAudience(requestOrigin)
      : null;
    if (!audience) {
      return new NextResponse(null, { status: 401 });
    }

    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return new NextResponse(null, { status: 401 });
    }

    const session = await validateForwardAuthSession(token, audience);
    if (!session) {
      return new NextResponse(null, { status: 401 });
    }

    const user = await getUserById(session.userId);
    if (!user || user.status !== "active") {
      return new NextResponse(null, { status: 401 });
    }

    const hasAccess = await checkHostAccess(session.userId, audience.proxyHostId);
    if (!hasAccess) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Get user's groups for the header
    const userGroups = await getGroupsForUser(session.userId);
    const groupNames = userGroups.map((g) => g.name).join(",");

    // Return 200 with user info headers that Caddy will copy to upstream.
    // Values are sanitized so non-ASCII identities (names, group names) can't throw.
    return new NextResponse(null, {
      status: 200,
      headers: {
        "X-CPM-User": toHeaderValue(user.name ?? user.email.split("@")[0]),
        "X-CPM-Email": toHeaderValue(user.email),
        "X-CPM-Groups": toHeaderValue(groupNames),
        "X-CPM-User-Id": String(user.id)
      }
    });
  } catch (error) {
    // Fail closed on any unexpected error (e.g. header construction) and log for diagnosis.
    console.error("[forward-auth/verify] unexpected error", error);
    return new NextResponse(null, { status: 401 });
  }
}
