CREATE TABLE `exam_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`published` text DEFAULT 'closed' NOT NULL,
	`batch_id` text,
	`imported_at` text,
	`is_demo` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`exam_no` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scores` text NOT NULL,
	`total` text NOT NULL
);
