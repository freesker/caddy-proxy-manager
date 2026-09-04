import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";

// Cast via unknown because better-auth's usernameClient $InferServerPlugin requires
// `email: string` while BetterAuthClientPlugin accepts an optional email field.
const usernamePlugin = usernameClient() as unknown as BetterAuthClientPlugin;

export const authClient = createAuthClient({
  plugins: [usernamePlugin],
});
