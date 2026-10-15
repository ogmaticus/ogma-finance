CREATE TABLE `owner_data_state` (
	`owner` text PRIMARY KEY NOT NULL,
	`generation` integer NOT NULL,
	`deleting` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `screenshot_owner_created_id` ON `screenshot_files` (`owner`,`created_at`,`id`);