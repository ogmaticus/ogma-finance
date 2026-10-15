CREATE TABLE `budget_documents` (
	`owner` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budget_versions` (
	`owner` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `screenshot_files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`hash` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`source_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `screenshot_owner_hash` ON `screenshot_files` (`owner`,`hash`);