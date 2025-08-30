import * as dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { users } from '../lib/db/schema';

dotenv.config({ path: '.env.local' });

async function checkUser() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection, { mode: 'default' });

  try {
    const allUsers = await db.select().from(users);
    console.log('All users in database:');
    allUsers.forEach(user => {
      console.log(`ID: ${user.id}, Email: ${user.email}, Name: ${user.name}, Admin: ${user.isAdmin}`);
      console.log(`Password hash: ${user.password}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
  
  await connection.end();
}

checkUser();