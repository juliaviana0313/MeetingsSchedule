CREATE TABLE `public_booking_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`response` text,
	`http_status` integer,
	`expires_at` integer NOT NULL
);
