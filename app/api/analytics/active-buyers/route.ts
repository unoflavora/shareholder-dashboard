import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholdings, shareholders } from '@/lib/db/schema';
import { sql, and, gte, lte, eq, gt } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const periodType = searchParams.get('periodType') || 'daily'; // daily or monthly

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    // Get all shareholdings within the date range
    const conditions = [];
    conditions.push(gte(shareholdings.date, startDate));
    conditions.push(lte(shareholdings.date, endDate));

    // Get shareholdings data with shareholder info
    const shareholdingsData = await db
      .select({
        shareholderId: shareholdings.shareholderId,
        shareholderName: shareholders.name,
        date: shareholdings.date,
        shares: shareholdings.sharesAmount,
        percentage: shareholdings.percentage,
      })
      .from(shareholdings)
      .innerJoin(shareholders, eq(shareholdings.shareholderId, shareholders.id))
      .where(and(...conditions))
      .orderBy(shareholdings.shareholderId, shareholdings.date);

    // Group by shareholder and analyze their buying patterns
    const shareholderMap = new Map();
    
    shareholdingsData.forEach(record => {
      if (!shareholderMap.has(record.shareholderId)) {
        shareholderMap.set(record.shareholderId, {
          id: record.shareholderId,
          name: record.shareholderName,
          records: []
        });
      }
      shareholderMap.get(record.shareholderId).records.push({
        date: record.date,
        shares: record.shares,
        percentage: record.percentage
      });
    });

    // Identify active buyers (those whose positions increased)
    const activeBuyers = [];
    
    for (const [shareholderId, data] of shareholderMap) {
      const records = data.records.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      if (records.length < 2) continue;
      
      const firstRecord = records[0];
      const lastRecord = records[records.length - 1];
      const shareChange = lastRecord.shares - firstRecord.shares;
      const percentageChange = lastRecord.percentage - firstRecord.percentage;
      
      // Only include those who increased their position
      if (shareChange > 0) {
        // Calculate buying activity metrics
        let buyingDays = 0;
        let totalIncrease = 0;
        const buyingActivity = [];
        
        for (let i = 1; i < records.length; i++) {
          const change = records[i].shares - records[i-1].shares;
          if (change > 0) {
            buyingDays++;
            totalIncrease += change;
            buyingActivity.push({
              date: records[i].date,
              increase: change,
              newTotal: records[i].shares
            });
          }
        }
        
        activeBuyers.push({
          shareholderId: shareholderId,
          name: data.name,
          initialShares: firstRecord.shares,
          finalShares: lastRecord.shares,
          totalIncrease: shareChange,
          increasePercent: ((shareChange / firstRecord.shares) * 100).toFixed(2),
          initialOwnership: firstRecord.percentage,
          finalOwnership: lastRecord.percentage,
          ownershipChange: percentageChange,
          buyingDays: buyingDays,
          averageIncreasePerBuy: buyingDays > 0 ? Math.round(totalIncrease / buyingDays) : 0,
          firstDate: firstRecord.date,
          lastDate: lastRecord.date,
          buyingActivity: buyingActivity
        });
      }
    }

    // Sort by total increase (most active buyers first)
    activeBuyers.sort((a, b) => b.totalIncrease - a.totalIncrease);

    // Calculate summary statistics
    const totalActiveBuyers = activeBuyers.length;
    const totalSharesAccumulated = activeBuyers.reduce((sum, buyer) => sum + buyer.totalIncrease, 0);
    const averageIncrease = totalActiveBuyers > 0 ? Math.round(totalSharesAccumulated / totalActiveBuyers) : 0;
    
    // Get daily/monthly trend data for chart
    const trendData = [];
    const dateMap = new Map();
    
    activeBuyers.forEach(buyer => {
      buyer.buyingActivity.forEach(activity => {
        const dateKey = periodType === 'monthly' 
          ? activity.date.substring(0, 7) // YYYY-MM
          : activity.date; // YYYY-MM-DD
          
        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, {
            date: dateKey,
            buyersCount: new Set(),
            totalIncrease: 0
          });
        }
        
        const dayData = dateMap.get(dateKey);
        dayData.buyersCount.add(buyer.shareholderId);
        dayData.totalIncrease += activity.increase;
      });
    });
    
    // Convert to array and sort by date
    for (const [date, data] of dateMap) {
      trendData.push({
        date: date,
        activeBuyers: data.buyersCount.size,
        sharesAccumulated: data.totalIncrease
      });
    }
    
    trendData.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      summary: {
        totalActiveBuyers,
        totalSharesAccumulated,
        averageIncrease,
        topAccumulator: activeBuyers[0] || null,
        period: {
          start: startDate,
          end: endDate,
          type: periodType
        }
      },
      buyers: activeBuyers.slice(0, 100), // Limit to top 100
      trendData
    });
  } catch (error) {
    console.error('Error fetching active buyers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active buyers data' },
      { status: 500 }
    );
  }
}