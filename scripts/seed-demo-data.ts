import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { shareholders, shareholdings } from '../lib/db/schema';

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('❌ Database credentials not found');
  process.exit(1);
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const db = drizzle(client);

async function seedDemoData() {
  console.log('🌱 Starting data seeding...');

  try {
    console.log('Clearing existing data...');
    await db.delete(shareholdings);
    await db.delete(shareholders);

    const profiles = [
      // Buyers (will increase positions in last 30 days)
      { name: 'PT Investasi Cemerlang', type: 'buyer', initial: 100000 },
      { name: 'Yayasan Dana Pensiun', type: 'buyer', initial: 80000 },
      { name: 'Budi Santoso', type: 'buyer', initial: 50000 },
      { name: 'CV Maju Jaya', type: 'buyer', initial: 30000 },
      { name: 'Koperasi Sejahtera', type: 'buyer', initial: 25000 },
      
      // Sellers (will decrease in last 30 days)
      { name: 'Ahmad Ibrahim', type: 'seller', initial: 150000 },
      { name: 'PT Karya Mandiri', type: 'seller', initial: 120000 },
      { name: 'Siti Nurhaliza', type: 'seller', initial: 90000 },
      { name: 'CV Berkah Usaha', type: 'seller', initial: 70000 },
      { name: 'Tommy Wirawan', type: 'seller', initial: 100000 },
      
      // Stable holders
      { name: 'Bank Nasional', type: 'stable', initial: 500000 },
      { name: 'PT Induk Holding', type: 'stable', initial: 1000000 },
      
      // New entrants (appear only in last 30 days)
      { name: 'Start-up Ventures', type: 'new', initial: 45000 },
      { name: 'Millennial Invest', type: 'new', initial: 35000 },
      { name: 'Digital Capital', type: 'new', initial: 28000 },
      { name: 'Tech Fund Asia', type: 'new', initial: 52000 },
      { name: 'Innovation Partners', type: 'new', initial: 41000 },
    ];

    console.log('Creating shareholders...');
    const created = [];
    for (const p of profiles) {
      const [s] = await db.insert(shareholders).values({
        name: p.name,
        shareholderNo: Math.floor(Math.random() * 1000000).toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();
      created.push({ ...s, ...p });
    }

    // Generate dates: 60 days ago to today (to ensure before/after period data)
    const dates = [];
    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - 60);
    
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 3)) {
      dates.push(d.toISOString().split('T')[0]);
    }

    const totalShares = 10000000;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    console.log('Creating shareholding records...');
    
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const isRecent = new Date(date) >= thirtyDaysAgo;
      
      for (const sh of created) {
        let shares = 0;
        
        if (sh.type === 'buyer') {
          // Start with base, increase in recent period
          if (isRecent) {
            shares = sh.initial + Math.floor(sh.initial * 0.3 * (i / dates.length));
          } else {
            shares = sh.initial;
          }
        } 
        else if (sh.type === 'seller') {
          // Start high, decrease in recent period
          if (isRecent) {
            const reduction = 0.4 * (i - dates.length/2) / (dates.length/2);
            shares = Math.floor(sh.initial * (1 - Math.max(0, reduction)));
          } else {
            shares = sh.initial;
          }
        }
        else if (sh.type === 'stable') {
          shares = sh.initial + Math.floor((Math.random() - 0.5) * sh.initial * 0.02);
        }
        else if (sh.type === 'new') {
          // Only appear in last 30 days
          if (!isRecent) continue;
          const daysIn = i - Math.floor(dates.length * 0.5);
          if (daysIn < created.filter(s => s.type === 'new').indexOf(sh) * 2) continue;
          shares = sh.initial + Math.floor(sh.initial * 0.1 * daysIn / 10);
        }

        if (shares > 0) {
          await db.insert(shareholdings).values({
            shareholderId: sh.id,
            date: date,
            sharesAmount: shares,
            percentage: (shares / totalShares) * 100,
            createdAt: new Date(),
          });
        }
      }
      
      console.log(`✓ Created records for ${date}`);
    }

    console.log('\n✅ Data seeding completed!');
    console.log(`- Created ${created.length} shareholders`);
    console.log(`- Buyers: ${created.filter(s => s.type === 'buyer').length}`);
    console.log(`- Sellers: ${created.filter(s => s.type === 'seller').length}`);
    console.log(`- New (last 30 days): ${created.filter(s => s.type === 'new').length}`);
    console.log(`- Date range: ${dates[0]} to ${dates[dates.length-1]}`);
    console.log(`- Last 30 days from: ${thirtyDaysAgoStr}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

seedDemoData();