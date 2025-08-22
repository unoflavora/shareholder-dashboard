import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, sql } from 'drizzle-orm';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Import schema
import { shareholders, shareholdings } from '../lib/db/schema';

// Create database connection for seeding
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('❌ Database credentials not found. Please check your .env.local file.');
  console.error('Required: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
  process.exit(1);
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const db = drizzle(client);

// Generate sample data with realistic patterns
async function seedDemoData() {
  console.log('🌱 Starting data seeding...');

  try {
    // Clear existing data (optional - comment out if you want to keep existing data)
    console.log('Clearing existing data...');
    await db.delete(shareholdings);
    await db.delete(shareholders);

    // Define shareholder profiles with different behaviors
    const shareholderProfiles = [
      // Active Buyers (accumulating over time)
      { name: 'PT Investasi Cemerlang', type: 'buyer', initialShares: 100000 },
      { name: 'Yayasan Dana Pensiun', type: 'buyer', initialShares: 80000 },
      { name: 'Budi Santoso', type: 'buyer', initialShares: 50000 },
      { name: 'CV Maju Jaya', type: 'buyer', initialShares: 30000 },
      { name: 'Koperasi Sejahtera', type: 'buyer', initialShares: 25000 },
      
      // Active Sellers (reducing positions)
      { name: 'Ahmad Ibrahim', type: 'seller', initialShares: 150000 },
      { name: 'PT Karya Mandiri', type: 'seller', initialShares: 120000 },
      { name: 'Siti Nurhaliza', type: 'seller', initialShares: 90000 },
      { name: 'CV Berkah Usaha', type: 'seller', initialShares: 70000 },
      
      // Swing Traders (buy low, sell high)
      { name: 'Robert Wijaya', type: 'trader', initialShares: 60000 },
      { name: 'PT Trading Dinamis', type: 'trader', initialShares: 100000 },
      { name: 'Hedge Fund Alpha', type: 'trader', initialShares: 200000 },
      
      // Stable Holders
      { name: 'Bank Nasional', type: 'stable', initialShares: 500000 },
      { name: 'PT Induk Holding', type: 'stable', initialShares: 1000000 },
      { name: 'Asuransi Jiwa Bersama', type: 'stable', initialShares: 300000 },
      
      // New Entrants (will appear in last 30 days for the "New" tab)
      { name: 'Start-up Ventures', type: 'new_recent', initialShares: 0 },
      { name: 'Millennial Invest', type: 'new_recent', initialShares: 0 },
      { name: 'Digital Capital', type: 'new_recent', initialShares: 0 },
      { name: 'Tech Fund Asia', type: 'new_recent', initialShares: 0 },
      { name: 'Innovation Partners', type: 'new_recent', initialShares: 0 },
      { name: 'Crypto Holdings', type: 'new_recent', initialShares: 0 },
      { name: 'Gen-Z Investment', type: 'new_recent', initialShares: 0 },
      { name: 'Future Capital', type: 'new_recent', initialShares: 0 },
      
      // New Entrants (appeared earlier, 2-3 months ago)
      { name: 'Venture Partners', type: 'new_early', initialShares: 0 },
      { name: 'Growth Fund Indonesia', type: 'new_early', initialShares: 0 },
      { name: 'Emerging Markets Fund', type: 'new_early', initialShares: 0 },
    ];

    // Create shareholders
    console.log('Creating shareholders...');
    const createdShareholders = [];
    for (const profile of shareholderProfiles) {
      const [shareholder] = await db.insert(shareholders).values({
        name: profile.name,
        shareholderNo: Math.floor(Math.random() * 1000000).toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();
      createdShareholders.push({ ...shareholder, ...profile });
    }

    // Generate dates for the last 6 months
    const dates = [];
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 7)) {
      dates.push(new Date(d).toISOString().split('T')[0]);
    }

    // Calculate total shares for percentage calculation
    const totalShares = 10000000;

    console.log('Creating shareholding records...');
    
    // Calculate key date indices
    const totalDates = dates.length;
    const last30DaysIndex = totalDates - 5; // Approximately last 30 days (5 weeks)
    const twoMonthsAgoIndex = totalDates - 9; // Approximately 2 months ago
    
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      
      for (const shareholder of createdShareholders) {
        let shares = shareholder.initialShares;
        
        // Apply behavioral patterns based on shareholder type
        if (shareholder.type === 'buyer') {
          // Gradually increase position
          shares = Math.floor(shareholder.initialShares * (1 + (i * 0.05)));
          // Some coordination - multiple buyers act on same dates
          if (i % 3 === 0 && Math.random() > 0.3) {
            shares = Math.floor(shares * 1.1); // 10% bump on coordinated days
          }
        } 
        else if (shareholder.type === 'seller') {
          // Gradually decrease position
          shares = Math.floor(shareholder.initialShares * Math.max(0, 1 - (i * 0.06)));
          // Complete exit for some
          if (i > totalDates * 0.7 && shareholder.name.includes('CV')) {
            shares = 0; // Complete exit
          }
        } 
        else if (shareholder.type === 'trader') {
          // Swing trading pattern
          if (i < totalDates * 0.3) {
            // Accumulation phase
            shares = Math.floor(shareholder.initialShares * (1 + (i * 0.08)));
          } else if (i > totalDates * 0.7) {
            // Distribution phase
            shares = Math.floor(shareholder.initialShares * 0.3);
          } else {
            // Peak holding
            shares = Math.floor(shareholder.initialShares * 1.5);
          }
        } 
        else if (shareholder.type === 'stable') {
          // Minor fluctuations only
          shares = Math.floor(shareholder.initialShares * (1 + (Math.random() - 0.5) * 0.02));
        } 
        else if (shareholder.type === 'new_recent') {
          // New entrants appear in the last 30 days
          if (i < last30DaysIndex) {
            continue; // Don't create records yet
          } else if (i === last30DaysIndex) {
            // First appearance - stagger their entry
            const entryDelay = createdShareholders.filter(s => s.type === 'new_recent').indexOf(shareholder);
            if (i < last30DaysIndex + Math.floor(entryDelay / 2)) {
              continue;
            }
            shares = Math.floor(Math.random() * 30000 + 10000);
            shareholder.initialShares = shares;
          } else {
            // Gradual accumulation after entry
            shares = Math.floor(shareholder.initialShares * (1 + ((i - last30DaysIndex) * 0.05)));
          }
        }
        else if (shareholder.type === 'new_early') {
          // Earlier new entrants (2-3 months ago)
          if (i < twoMonthsAgoIndex) {
            continue; // Don't create records yet
          } else if (i === twoMonthsAgoIndex) {
            // First appearance
            shares = Math.floor(Math.random() * 40000 + 20000);
            shareholder.initialShares = shares;
          } else {
            // Steady growth since entry
            shares = Math.floor(shareholder.initialShares * (1 + ((i - twoMonthsAgoIndex) * 0.03)));
          }
        }

        // Only create record if shares > 0
        if (shares > 0) {
          const percentage = (shares / totalShares) * 100;
          
          await db.insert(shareholdings).values({
            shareholderId: shareholder.id,
            date: date,
            sharesAmount: shares,
            percentage: percentage,
            createdAt: new Date(),
          });
        }
      }
      
      console.log(`✓ Created records for ${date}`);
    }

    // Create some coordinated group activities in the last 30 days
    console.log('Creating coordinated activities...');
    
    // Get buyer group IDs
    const buyerGroup = createdShareholders.filter(s => s.type === 'buyer').slice(0, 3);
    const recentDates = dates.slice(last30DaysIndex); // Last 30 days
    const coordinatedDates = recentDates.filter((_, i) => i % 2 === 0); // Every other date
    
    for (const date of coordinatedDates) {
      for (const buyer of buyerGroup) {
        // Add extra purchases on these dates
        const existingRecords = await db.select()
          .from(shareholdings)
          .where(sql`${shareholdings.shareholderId} = ${buyer.id} AND ${shareholdings.date} = ${date}`);
          
        if (existingRecords.length > 0) {
          const newShares = Math.floor(existingRecords[0].sharesAmount * 1.15);
          await db.update(shareholdings)
            .set({ 
              sharesAmount: newShares,
              percentage: (newShares / totalShares) * 100
            })
            .where(sql`${shareholdings.shareholderId} = ${buyer.id} AND ${shareholdings.date} = ${date}`);
        }
      }
    }

    console.log('✅ Data seeding completed successfully!');
    console.log(`Created ${createdShareholders.length} shareholders`);
    console.log(`Created records for ${dates.length} dates`);
    console.log('\nSummary:');
    console.log(`- Active Buyers: ${createdShareholders.filter(s => s.type === 'buyer').length}`);
    console.log(`- Active Sellers: ${createdShareholders.filter(s => s.type === 'seller').length}`);
    console.log(`- Traders: ${createdShareholders.filter(s => s.type === 'trader').length}`);
    console.log(`- Stable Holders: ${createdShareholders.filter(s => s.type === 'stable').length}`);
    console.log(`- New Entrants (Last 30 days): ${createdShareholders.filter(s => s.type === 'new_recent').length}`);
    console.log(`- New Entrants (Earlier): ${createdShareholders.filter(s => s.type === 'new_early').length}`);
    
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the seeding
seedDemoData();