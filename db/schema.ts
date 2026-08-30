import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const preferences = sqliteTable('preferences', {
  id: integer('id').primaryKey(),
  citiesJson: text('cities_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});
