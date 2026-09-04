-- Better Auth 1.7 identifies accounts by (issuer, accountId), not by
-- (providerId, accountId). Build the replacement table first and enforce the
-- new identity key before touching the original so collisions fail closed.
CREATE TABLE `accounts_v17` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `userId` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `issuer` text NOT NULL,
  `accountId` text NOT NULL,
  `providerId` text NOT NULL,
  `accessToken` text,
  `refreshToken` text,
  `idToken` text,
  `accessTokenExpiresAt` text,
  `refreshTokenExpiresAt` text,
  `scope` text,
  `password` text,
  `createdAt` text NOT NULL,
  `updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_v17_identity_guard`
  ON `accounts_v17` (`issuer`, `accountId`);
--> statement-breakpoint
INSERT INTO `accounts_v17` (
  `id`, `userId`, `issuer`, `accountId`, `providerId`, `accessToken`,
  `refreshToken`, `idToken`, `accessTokenExpiresAt`,
  `refreshTokenExpiresAt`, `scope`, `password`, `createdAt`, `updatedAt`
)
SELECT
  account.`id`,
  account.`userId`,
  CASE
    WHEN account.`providerId` = 'credential' THEN 'local:credential'
    ELSE COALESCE(
      (
        SELECT NULLIF(TRIM(provider.`issuer`), '')
        FROM `oauth_providers` AS provider
        WHERE provider.`id` = account.`providerId`
        LIMIT 1
      ),
      -- CPM-generated provider IDs are UUIDs or lowercase slugs, so they need
      -- no additional encodeURIComponent escaping in this SQL backfill.
      'local:oauth:' || account.`providerId`
    )
  END,
  account.`accountId`,
  account.`providerId`,
  account.`accessToken`,
  account.`refreshToken`,
  account.`idToken`,
  account.`accessTokenExpiresAt`,
  account.`refreshTokenExpiresAt`,
  account.`scope`,
  account.`password`,
  account.`createdAt`,
  account.`updatedAt`
FROM `accounts` AS account;
--> statement-breakpoint
DROP INDEX `accounts_v17_identity_guard`;
--> statement-breakpoint
DROP TABLE `accounts`;
--> statement-breakpoint
ALTER TABLE `accounts_v17` RENAME TO `accounts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_issuer_account_idx`
  ON `accounts` (`issuer`, `accountId`);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`userId`);
