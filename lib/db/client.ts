import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not found. Please check your environment variables.');
}

// Create connection pool
const connectionPool = mysql.createPool(process.env.DATABASE_URL);
export const db = drizzle(connectionPool, { schema, mode: 'default' });

export type Database = ReturnType<typeof drizzle>;