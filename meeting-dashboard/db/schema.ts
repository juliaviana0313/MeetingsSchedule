import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const emailAuthUsers = sqliteTable('email_auth_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  verifiedAt: integer('verified_at').notNull(),
});
export const emailAuthChallenges = sqliteTable('email_auth_challenges', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  browserHash: text('browser_hash').notNull(),
  expiresAt: integer('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  usedAt: integer('used_at'),
});
export const emailAuthLimits = sqliteTable('email_auth_limits', {
  id: text('id').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

// Anonymous receipts are scoped to an encrypted visitor cookie; there is no public listing.
export const publicBookingRequests = sqliteTable('public_booking_requests', {
  id: text('id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  state: text('state').notNull(),
  response: text('response'),
  httpStatus: integer('http_status'),
  expiresAt: integer('expires_at').notNull(),
});
