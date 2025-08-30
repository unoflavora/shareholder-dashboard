import * as dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { users } from '../lib/db/schema';

dotenv.config({ path: '.env.local' });

async function testAuth() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection, { mode: 'default' });

  try {
    console.log('Testing authentication for admin@example.com...');
    
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@example.com'))
      .limit(1);

    if (!user.length) {
      console.log('❌ User not found');
      return;
    }

    console.log('✅ User found:', user[0].email);
    console.log('Stored hash:', user[0].password);

    const testPassword = 'example123';
    const isValid = await bcrypt.compare(testPassword, user[0].password);
    
    console.log('Password test result:', isValid ? '✅ VALID' : '❌ INVALID');
    
    // Let's also test hash generation
    const newHash = bcrypt.hashSync(testPassword, 10);
    console.log('Newly generated hash:', newHash);
    const newHashValid = await bcrypt.compare(testPassword, newHash);
    console.log('New hash test:', newHashValid ? '✅ VALID' : '❌ INVALID');
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  await connection.end();
}

testAuth();