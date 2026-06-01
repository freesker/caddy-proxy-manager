ALTER TABLE `oauth_providers` ADD COLUMN `rolesClaim` text;
--> statement-breakpoint
CREATE TABLE `oauth_role_mappings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `providerId` text NOT NULL REFERENCES `oauth_providers`(`id`) ON DELETE CASCADE,
  `role` text NOT NULL,
  `groupId` integer NOT NULL REFERENCES `groups`(`id`) ON DELETE CASCADE,
  `createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_role_mappings_unique` ON `oauth_role_mappings` (`providerId`, `role`, `groupId`);
--> statement-breakpoint
CREATE INDEX `oauth_role_mappings_provider_idx` ON `oauth_role_mappings` (`providerId`);
--> statement-breakpoint
CREATE INDEX `oauth_role_mappings_group_idx` ON `oauth_role_mappings` (`groupId`);
