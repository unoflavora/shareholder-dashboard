import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholdings, shareholders } from '@/lib/db/schema';
import { sql, and, gte, lte, eq, lt } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const periodType = searchParams.get('periodType') || 'daily';

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    // Get all shareholders who appeared before the period
    const existingShareholdersData = await db
      .selectDistinct({
        shareholderId: shareholdings.shareholderId,
      })
      .from(shareholdings)
      .where(lt(shareholdings.date, startDate));

    const existingShareholderIds = new Set(existingShareholdersData.map(s => s.shareholderId));

    // Get all shareholdings within the period
    const periodShareholdingsData = await db
      .select({
        shareholderId: shareholdings.shareholderId,
        shareholderName: shareholders.name,
        date: shareholdings.date,
        shares: shareholdings.sharesAmount,
        percentage: shareholdings.percentage,
      })
      .from(shareholdings)
      .innerJoin(shareholders, eq(shareholdings.shareholderId, shareholders.id))
      .where(and(
        gte(shareholdings.date, startDate),
        lte(shareholdings.date, endDate)
      ))
      .orderBy(shareholdings.date, shareholdings.shareholderId);

    // Group by shareholder and find new ones
    const newShareholdersMap = new Map();
    
    periodShareholdingsData.forEach(record => {
      // Check if this shareholder is new (didn't exist before the period)
      if (!existingShareholderIds.has(record.shareholderId)) {
        if (!newShareholdersMap.has(record.shareholderId)) {
          newShareholdersMap.set(record.shareholderId, {
            id: record.shareholderId,
            name: record.shareholderName,
            firstAppearance: record.date,
            records: []
          });
        }
        
        const shareholderData = newShareholdersMap.get(record.shareholderId);
        shareholderData.records.push({
          date: record.date,
          shares: record.shares,
          percentage: record.percentage
        });
        
        // Update first appearance if this date is earlier
        if (record.date < shareholderData.firstAppearance) {
          shareholderData.firstAppearance = record.date;
        }
      }
    });

    // Process new shareholders data
    const newShareholders = [];
    
    for (const [shareholderId, data] of newShareholdersMap) {
      const records = data.records.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const firstRecord = records[0];
      const lastRecord = records[records.length - 1];
      
      const growthSinceEntry = lastRecord.shares - firstRecord.shares;
      const growthPercent = firstRecord.shares > 0 
        ? ((growthSinceEntry / firstRecord.shares) * 100).toFixed(2)
        : '0';
      
      newShareholders.push({
        shareholderId: shareholderId,
        name: data.name,
        entryDate: data.firstAppearance,
        initialShares: firstRecord.shares,
        currentShares: lastRecord.shares,
        growthSinceEntry: growthSinceEntry,
        growthPercent: growthPercent,
        initialOwnership: firstRecord.percentage,
        currentOwnership: lastRecord.percentage,
        ownershipChange: lastRecord.percentage - firstRecord.percentage,
        daysActive: records.length,
        trajectory: growthSinceEntry > 0 ? 'Accumulating' : growthSinceEntry < 0 ? 'Reducing' : 'Stable'
      });
    }

    // Sort by entry date (newest first) then by initial shares
    newShareholders.sort((a, b) => {
      const dateCompare = b.entryDate.localeCompare(a.entryDate);
      if (dateCompare !== 0) return dateCompare;
      return b.initialShares - a.initialShares;
    });

    // Calculate entry trend data for chart
    const entryTrendData = [];
    const entryDateMap = new Map();
    
    newShareholders.forEach(shareholder => {
      const dateKey = periodType === 'monthly' 
        ? shareholder.entryDate.substring(0, 7)
        : shareholder.entryDate;
        
      if (!entryDateMap.has(dateKey)) {
        entryDateMap.set(dateKey, {
          date: dateKey,
          newEntrants: 0,
          totalInitialShares: 0,
          totalCurrentShares: 0,
          entrantNames: []
        });
      }
      
      const dayData = entryDateMap.get(dateKey);
      dayData.newEntrants++;
      dayData.totalInitialShares += shareholder.initialShares;
      dayData.totalCurrentShares += shareholder.currentShares;
      dayData.entrantNames.push(shareholder.name);
    });
    
    // Convert to array and sort by date
    for (const [date, data] of entryDateMap) {
      entryTrendData.push({
        date: date,
        newEntrants: data.newEntrants,
        totalInitialShares: data.totalInitialShares,
        totalCurrentShares: data.totalCurrentShares,
        averageEntry: Math.round(data.totalInitialShares / data.newEntrants),
        entrantNames: data.entrantNames.slice(0, 5) // Top 5 names for tooltip
      });
    }
    
    entryTrendData.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate summary statistics
    const totalNewShareholders = newShareholders.length;
    const totalInitialInvestment = newShareholders.reduce((sum, s) => sum + s.initialShares, 0);
    const totalCurrentHoldings = newShareholders.reduce((sum, s) => sum + s.currentShares, 0);
    const averageEntrySize = totalNewShareholders > 0 ? Math.round(totalInitialInvestment / totalNewShareholders) : 0;
    const accumulatingCount = newShareholders.filter(s => s.trajectory === 'Accumulating').length;
    const reducingCount = newShareholders.filter(s => s.trajectory === 'Reducing').length;
    const stableCount = newShareholders.filter(s => s.trajectory === 'Stable').length;

    return NextResponse.json({
      summary: {
        totalNewShareholders,
        totalInitialInvestment,
        totalCurrentHoldings,
        netChange: totalCurrentHoldings - totalInitialInvestment,
        averageEntrySize,
        trajectories: {
          accumulating: accumulatingCount,
          reducing: reducingCount,
          stable: stableCount
        },
        topNewEntrant: newShareholders[0] || null,
        period: {
          start: startDate,
          end: endDate,
          type: periodType
        }
      },
      newShareholders: newShareholders.slice(0, 100), // Limit to 100
      entryTrendData
    });
  } catch (error) {
    console.error('Error fetching new shareholders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch new shareholders data' },
      { status: 500 }
    );
  }
}