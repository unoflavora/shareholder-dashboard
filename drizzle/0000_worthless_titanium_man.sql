CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`action` varchar(100) NOT NULL,
	`entity_type` varchar(50),
	`entity_id` int,
	`details` text,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shareholders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shareholder_no` int,
	`name` varchar(255) NOT NULL,
	`account_holder` varchar(255),
	`sheet_name` varchar(100),
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shareholders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shareholdings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shareholder_id` int,
	`date` varchar(10) NOT NULL,
	`shares_amount` int NOT NULL,
	`percentage` decimal(10,6) NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `shareholdings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`filename` varchar(255) NOT NULL,
	`upload_date` varchar(10) NOT NULL,
	`records_count` int,
	`status` varchar(50),
	`uploaded_by` int,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `uploads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`password` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`is_admin` boolean DEFAULT false,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shareholdings` ADD CONSTRAINT `shareholdings_shareholder_id_shareholders_id_fk` FOREIGN KEY (`shareholder_id`) REFERENCES `shareholders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;