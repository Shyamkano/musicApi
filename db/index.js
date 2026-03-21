import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

if (!process.env.DATABASE_URL) {
  console.warn('⚠️ DATABASE_URL not found in .env — make sure you add your Neon connection string!');
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
