import { pgTable, uuid, text, integer, char, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const services = pgTable('services', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  area: text('area').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('services_name_area_unique').on(sql`lower(${table.name})`, sql`lower(${table.area})`).where(sql`${table.status} <> 'archived'`),
  check('services_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 100`),
  check('services_area_length', sql`char_length(${table.area}) BETWEEN 1 AND 80`),
]);

export const plans = pgTable('plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  billingCadence: text('billing_cadence').notNull(),
  priceMinor: integer('price_minor'),
  currency: char('currency', { length: 3 }).notNull().default('EUR'),
  periodDays: integer('period_days'),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('plans_service_idx').on(table.serviceId, table.status),
  check('plans_cadence_allowed', sql`${table.billingCadence} IN ('monthly', 'weekly', 'session_pack', 'period')`),
  check('plans_status_allowed', sql`${table.status} IN ('active', 'draft', 'archived')`),
  check('plans_price_nonnegative', sql`${table.priceMinor} IS NULL OR ${table.priceMinor} >= 0`),
]);

export const planRights = pgTable('plan_rights', {
  id: uuid('id').defaultRandom().primaryKey(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  rightType: text('right_type').notNull(),
  quantity: integer('quantity'),
  period: text('period'),
  validDays: integer('valid_days'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('plan_rights_plan_idx').on(table.planId),
  check('plan_rights_type_allowed', sql`${table.rightType} IN ('service_access', 'sessions_quota', 'period_quota')`),
  check('plan_rights_period_allowed', sql`${table.period} IS NULL OR ${table.period} IN ('week', 'month', 'plan_period')`),
  check('plan_rights_type_quantity', sql`(${table.rightType} = 'service_access' AND ${table.quantity} IS NULL) OR (${table.rightType} <> 'service_access' AND ${table.quantity} > 0)`),
  check('plan_rights_period_required', sql`(${table.rightType} = 'period_quota' AND ${table.period} IS NOT NULL) OR (${table.rightType} <> 'period_quota')`),
]);
