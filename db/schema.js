import { pgTable, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), 
  name: text('name').notNull(),
  email: text('email').unique(),
  password: text('password'), // Optional for social login users
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const likedSongs = pgTable('liked_songs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull(),
  addedAt: timestamp('added_at').defaultNow(),
});

export const playlists = pgTable('playlists', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  image: text('image'),
  tracks: jsonb('tracks').default([]), // Array of song objects/IDs
  createdAt: timestamp('created_at').defaultNow(),
});
