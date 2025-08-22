import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

// Lazy initialization to prevent build-time errors
let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (!_db) {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      // Only throw error when actually trying to use the database
      if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development') {
        throw new Error('Database credentials not found. Please check your environment variables.');
      }
      // During build, return a mock that will never be used
      return {} as any;
    }

    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    _db = drizzle(client, { schema });
  }
  
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(target, prop, receiver) {
    const database = getDb();
    return Reflect.get(database, prop, receiver);
  }
});

export type Database = ReturnType<typeof drizzle>;