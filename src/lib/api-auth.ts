import { type NextRequest, NextResponse } from "next/server";
import { auth, checkSameOrigin } from "./auth";
import { validateToken } from "./models/api-tokens";
import { randomUUID } from "node:crypto";
import { ApiClientError } from "./api-errors";

export class ApiAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export type ApiAuthResult = {
  userId: number;
  role: string;
  authMethod: "bearer" | "session";
};

export async function authenticateApiRequest(
  request: NextRequest
): Promise<ApiAuthResult> {
  // Try Bearer token first
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const rawToken = authHeader.slice(7);
    if (!rawToken) {
      throw new ApiAuthError("Invalid Bearer token", 401);
    }

    const result = await validateToken(rawToken);
    if (!result) {
      throw new ApiAuthError("Invalid or expired API token", 401);
    }

    return {
      userId: result.user.id,
      role: result.user.role,
      authMethod: "bearer",
    };
  }

  // Fall back to session auth
  const session = await auth();
  if (!session?.user?.id) {
    throw new ApiAuthError("Unauthorized", 401);
  }

  // Deny access when role is missing rather than defaulting to "user"
  const role = session.user.role;
  if (!role) {
    throw new ApiAuthError("Session missing role claim", 401);
  }

  return {
    userId: Number(session.user.id),
    role,
    authMethod: "session",
  };
}

export async function requireApiUser(request: NextRequest): Promise<ApiAuthResult> {
  const result = await authenticateApiRequest(request);

  // CSRF check for session-authenticated mutating requests
  if (result.authMethod === "session") {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const csrfResponse = checkSameOrigin(request);
      if (csrfResponse) {
        throw new ApiAuthError("Forbidden", 403);
      }
    }
  }

  return result;
}

export async function requireApiAdmin(request: NextRequest): Promise<ApiAuthResult> {
  const result = await requireApiUser(request);
  if (result.role !== "admin") {
    throw new ApiAuthError("Administrator privileges required", 403);
  }
  return result;
}

/**
 * Helper to build an error response from an ApiAuthError or generic error.
 */
export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ApiClientError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  // Several model functions predate NotFoundError and use a fixed
  // "<resource> not found" message. Preserve their 404 contract without
  // reflecting the unexpected message (or any resource/internal detail).
  if (error instanceof Error && error.message.trim().toLowerCase().endsWith("not found")) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }
  const errorId = logUnexpectedApiError("Unhandled API error", error);
  return NextResponse.json(
    { error: "Internal server error", errorId },
    { status: 500 }
  );
}

/**
 * Log enough metadata to correlate unexpected failures without copying raw
 * exception messages, response bodies, URLs, or stacks into centralized logs.
 */
export function logUnexpectedApiError(context: string, error: unknown): string {
  const errorId = randomUUID();
  const rawType = error instanceof Error ? error.name : typeof error;
  const errorType = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawType)
    ? rawType
    : error instanceof Error ? "Error" : "unknown";
  const safeDetails: Record<string, unknown> = {
    errorId,
    context,
    errorType,
  };
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_-]{1,64}$/.test(code)) {
      safeDetails.code = code;
    } else if (typeof code === "number" && Number.isFinite(code)) {
      safeDetails.code = code;
    }
  }
  console.error("Unexpected API failure", safeDetails);
  return errorId;
}
