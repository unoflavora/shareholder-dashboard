import { mysqlTable, varchar, int, decimal, datetime, boolean, text, timestamp } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const users = mysqlTable('users', {
  id: int('id').primaryKey().autoincrement(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  isAdmin: boolean('is_admin').default(false),
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

export const shareholders = mysqlTable('shareholders', {
  id: int('id').primaryKey().autoincrement(),
  shareholderNo: int('shareholder_no'),
  name: varchar('name', { length: 255 }).notNull(),
  accountHolder: varchar('account_holder', { length: 255 }),
  sheetName: varchar('sheet_name', { length: 100 }),
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

export const shareholdings = mysqlTable('shareholdings', {
  id: int('id').primaryKey().autoincrement(),
  shareholderId: int('shareholder_id').references(() => shareholders.id),
  date: varchar('date', { length: 10 }).notNull(), // Store as ISO string YYYY-MM-DD, indexed
  sharesAmount: int('shares_amount').notNull(),
  percentage: decimal('percentage', { precision: 10, scale: 6 }).notNull(),
  createdAt: timestamp('created_at', { fsp: 6 }).notNull(),
});

export const uploads = mysqlTable('uploads', {
  id: int('id').primaryKey().autoincrement(),
  filename: varchar('filename', { length: 255 }).notNull(),
  uploadDate: varchar('upload_date', { length: 10 }).notNull(),
  recordsCount: int('records_count'),
  status: varchar('status', { length: 50 }),
  uploadedBy: int('uploaded_by').references(() => users.id),
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = mysqlTable('audit_logs', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }),
  entityId: int('entity_id'),
  details: text('details'), // JSON string
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Shareholder = typeof shareholders.$inferSelect;
export type NewShareholder = typeof shareholders.$inferInsert;
export type Shareholding = typeof shareholdings.$inferSelect;
export type NewShareholding = typeof shareholdings.$inferInsert;
export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;