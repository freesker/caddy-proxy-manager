-- Forward-auth sessions created before this migration were global bearer
-- credentials with no audience.  They cannot be migrated safely, so invalidate
-- them and recreate the ephemeral flow tables with mandatory audience binding.
DROP TABLE `forward_auth_exchanges`;
--> statement-breakpoint
DROP TABLE `forward_auth_redirect_intents`;
--> statement-breakpoint
DROP TABLE `forward_auth_sessions`;
--> statement-breakpoint
CREATE TABLE `forward_auth_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`proxyHostId` integer NOT NULL REFERENCES `proxy_hosts`(`id`) ON DELETE CASCADE,
	`audienceOrigin` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fas_token_hash_unique` ON `forward_auth_sessions` (`tokenHash`);
--> statement-breakpoint
CREATE INDEX `fas_user_idx` ON `forward_auth_sessions` (`userId`);
--> statement-breakpoint
CREATE INDEX `fas_proxy_host_idx` ON `forward_auth_sessions` (`proxyHostId`);
--> statement-breakpoint
CREATE INDEX `fas_expires_idx` ON `forward_auth_sessions` (`expiresAt`);
--> statement-breakpoint
CREATE TABLE `forward_auth_exchanges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sessionId` integer NOT NULL REFERENCES `forward_auth_sessions`(`id`) ON DELETE CASCADE,
	`proxyHostId` integer NOT NULL REFERENCES `proxy_hosts`(`id`) ON DELETE CASCADE,
	`audienceOrigin` text NOT NULL,
	`codeHash` text NOT NULL,
	`sessionToken` text NOT NULL,
	`redirectUri` text NOT NULL,
	`expiresAt` text NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fae_code_hash_unique` ON `forward_auth_exchanges` (`codeHash`);
--> statement-breakpoint
CREATE TABLE `forward_auth_redirect_intents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ridHash` text NOT NULL,
	`proxyHostId` integer NOT NULL REFERENCES `proxy_hosts`(`id`) ON DELETE CASCADE,
	`audienceOrigin` text NOT NULL,
	`redirectUri` text NOT NULL,
	`expiresAt` text NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fari_rid_hash_unique` ON `forward_auth_redirect_intents` (`ridHash`);
--> statement-breakpoint
CREATE INDEX `fari_expires_idx` ON `forward_auth_redirect_intents` (`expiresAt`);
