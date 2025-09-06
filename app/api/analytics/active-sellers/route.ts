import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholdings, shareholders } from '@/lib/db/schema';
import { sql, and, gte, lte, eq, min, max } from 'drizzle-orm';

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
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const sellerDateFilter = searchParams.get('sellerDateFilter');

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

    // Also check for shareholders who existed before the period but disappeared
    const beforePeriodData = await db
      .select({
        shareholderId: shareholdings.shareholderId,
        shareholderName: shareholders.name,
        shares: shareholdings.sharesAmount,
        percentage: shareholdings.percentage,
      })
      .from(shareholdings)
      .innerJoin(shareholders, eq(shareholdings.shareholderId, shareholders.id))
      .where(shareholdings.date < startDate)
      .orderBy(shareholdings.date);

    // Group by shareholder
    const shareholderMap = new Map();
    const beforePeriodMap = new Map();
    
    // Process before-period data
    beforePeriodData.forEach(record => {
      beforePeriodMap.set(record.shareholderId, {
        name: record.shareholderName,
        shares: record.shares,
        percentage: record.percentage
      });
    });
    
    // Process period data
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

    // Identify active sellers
    const activeSellers = [];
    
    // Check shareholders who reduced positions
    for (const [shareholderId, data] of shareholderMap) {
      const records = data.records.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      if (records.length < 2) continue;
      
      const firstRecord = records[0];
      const lastRecord = records[records.length - 1];
      const shareChange = lastRecord.shares - firstRecord.shares;
      
      // Include those who decreased their position
      if (shareChange < 0) {
        // Calculate selling activity
        let sellingDays = 0;
        let totalDecrease = 0;
        const sellingActivity = [];
        
        for (let i = 1; i < records.length; i++) {
          const change = records[i].shares - records[i-1].shares;
          if (change < 0) {
            sellingDays++;
            totalDecrease += Math.abs(change);
            sellingActivity.push({
              date: records[i].date,
              decrease: Math.abs(change),
              newTotal: records[i].shares
            });
          }
        }
        
        const exitStatus = lastRecord.shares === 0 ? 'Full Exit' : 'Partial Exit';
        const decreasePercent = firstRecord.shares > 0 
          ? ((Math.abs(shareChange) / firstRecord.shares) * 100).toFixed(2) 
          : '100';
        
        activeSellers.push({
          shareholderId: shareholderId,
          name: data.name,
          initialShares: firstRecord.shares,
          finalShares: lastRecord.shares,
          totalDecrease: Math.abs(shareChange),
          decreasePercent: decreasePercent,
          initialOwnership: firstRecord.percentage,
          finalOwnership: lastRecord.percentage,
          ownershipChange: lastRecord.percentage - firstRecord.percentage,
          exitStatus: exitStatus,
          sellingDays: sellingDays,
          averageDecreasePerSell: sellingDays > 0 ? Math.round(totalDecrease / sellingDays) : 0,
          firstDate: firstRecord.date,
          lastDate: lastRecord.date,
          sellingActivity: sellingActivity
        });
      }
    }
    
    // Check for complete exits (shareholders who disappeared)
    for (const [shareholderId, beforeData] of beforePeriodMap) {
      const inPeriod = shareholderMap.has(shareholderId);
      if (!inPeriod) {
        // Check if this shareholder actually has zero shares at the end date
        const latestRecord = await db
          .select({
            shares: shareholdings.sharesAmount,
            date: shareholdings.date
          })
          .from(shareholdings)
          .where(eq(shareholdings.shareholderId, shareholderId))
          .orderBy(sql`date DESC`)
          .limit(1);
        
        // Only mark as disappeared if they actually have zero shares in their latest record
        if (latestRecord.length > 0 && latestRecord[0].shares === 0) {
          activeSellers.push({
            shareholderId: shareholderId,
            name: beforeData.name,
            initialShares: beforeData.shares,
            finalShares: 0,
            totalDecrease: beforeData.shares,
            decreasePercent: '100',
            initialOwnership: beforeData.percentage,
            finalOwnership: 0,
            ownershipChange: -beforeData.percentage,
            exitStatus: 'Complete Disappearance',
            sellingDays: 1,
            averageDecreasePerSell: beforeData.shares,
            firstDate: latestRecord[0].date,
            lastDate: latestRecord[0].date,
            sellingActivity: [{
              date: latestRecord[0].date,
              decrease: beforeData.shares,
              newTotal: 0
            }]
          });
        }
      }
    }

    // Sort by total decrease (most active sellers first)
    activeSellers.sort((a, b) => b.totalDecrease - a.totalDecrease);

    // Apply seller date filter if provided
    let filteredSellers = activeSellers;
    if (sellerDateFilter) {
      // Search for shareholders who have data ON that specific date
      const onDateData = await db
        .select({
          shareholderId: shareholdings.shareholderId,
          shareholderName: shareholders.name,
          minTimestamp: min(shareholdings.createdAt),
          maxTimestamp: max(shareholdings.createdAt)
        })
        .from(shareholdings)
        .innerJoin(shareholders, eq(shareholdings.shareholderId, shareholders.id))
        .where(eq(shareholdings.date, sellerDateFilter))
        .groupBy(shareholdings.shareholderId, shareholders.name);

      // Identify shareholders who reduced positions on that date
      const validSellerIds = new Set();
      
      for (const record of onDateData) {
        // Get all records for this shareholder on that date, ordered by timestamp and ID
        const dayRecords = await db
          .select({
            shares: shareholdings.sharesAmount,
            timestamp: shareholdings.createdAt,
            id: shareholdings.id
          })
          .from(shareholdings)
          .where(and(
            eq(shareholdings.shareholderId, record.shareholderId),
            eq(shareholdings.date, sellerDateFilter)
          ))
          .orderBy(shareholdings.createdAt, shareholdings.id); // Use ID as tiebreaker for same timestamps

        // If there are multiple records, check for selling activity
        if (dayRecords.length > 1) {
          const firstShares = dayRecords[0].shares;
          const lastShares = dayRecords[dayRecords.length - 1].shares;
          
          // If shares decreased from first to last record
          if (lastShares < firstShares) {
            validSellerIds.add(record.shareholderId);
          }
        }
      }

      // Update seller statistics based on the specific date filter
      const updatedSellers = [];
      for (const seller of activeSellers) {
        if (validSellerIds.has(seller.shareholderId)) {
          // Get the actual selling activity on the filter date
          const dayRecords = await db
            .select({
              shares: shareholdings.sharesAmount,
              timestamp: shareholdings.createdAt
            })
            .from(shareholdings)
            .where(and(
              eq(shareholdings.shareholderId, seller.shareholderId),
              eq(shareholdings.date, sellerDateFilter)
            ))
            .orderBy(shareholdings.createdAt, shareholdings.id);

          if (dayRecords.length > 1) {
            const firstShares = dayRecords[0].shares;
            const lastShares = dayRecords[dayRecords.length - 1].shares;
            const actualDecrease = firstShares - lastShares;

            // Update the seller with correct statistics from the filter date
            updatedSellers.push({
              ...seller,
              initialShares: firstShares,
              finalShares: lastShares,
              totalDecrease: actualDecrease,
              decreasePercent: firstShares > 0 ? ((actualDecrease / firstShares) * 100).toFixed(2) : '100',
              exitStatus: lastShares === 0 ? 'Full Exit' : 'Partial Exit',
              firstDate: sellerDateFilter,
              lastDate: sellerDateFilter,
              sellingActivity: [{
                date: sellerDateFilter,
                decrease: actualDecrease,
                newTotal: lastShares
              }]
            });
          }
        }
      }
      
      filteredSellers = updatedSellers;
    }

    // Calculate pagination
    const totalSellers = filteredSellers.length;
    const totalPages = Math.ceil(totalSellers / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedSellers = filteredSellers.slice(startIndex, endIndex);

    // Calculate summary statistics
    const totalActiveSellers = activeSellers.length;
    const fullExits = activeSellers.filter(s => s.exitStatus === 'Full Exit' || s.exitStatus === 'Complete Disappearance').length;
    const partialExits = activeSellers.filter(s => s.exitStatus === 'Partial Exit').length;
    const totalSharesSold = activeSellers.reduce((sum, seller) => sum + seller.totalDecrease, 0);
    const averageDecrease = totalActiveSellers > 0 ? Math.round(totalSharesSold / totalActiveSellers) : 0;
    
    // Get daily/monthly trend data for chart
    const trendData = [];
    const dateMap = new Map();
    
    activeSellers.forEach(seller => {
      seller.sellingActivity.forEach(activity => {
        const dateKey = periodType === 'monthly' 
          ? activity.date.substring(0, 7)
          : activity.date;
          
        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, {
            date: dateKey,
            sellersCount: new Set(),
            totalDecrease: 0,
            fullExits: 0,
            partialExits: 0
          });
        }
        
        const dayData = dateMap.get(dateKey);
        dayData.sellersCount.add(seller.shareholderId);
        dayData.totalDecrease += activity.decrease;
        
        if (activity.newTotal === 0) {
          dayData.fullExits++;
        } else {
          dayData.partialExits++;
        }
      });
    });
    
    // Convert to array and sort by date
    for (const [date, data] of dateMap) {
      trendData.push({
        date: date,
        activeSellers: data.sellersCount.size,
        sharesSold: data.totalDecrease,
        fullExits: data.fullExits,
        partialExits: data.partialExits
      });
    }
    
    trendData.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      summary: {
        totalActiveSellers,
        fullExits,
        partialExits,
        totalSharesSold,
        averageDecrease,
        topSeller: activeSellers[0] || null,
        period: {
          start: startDate,
          end: endDate,
          type: periodType
        }
      },
      sellers: paginatedSellers,
      trendData,
      pagination: {
        page,
        limit,
        total: totalSellers,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching active sellers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active sellers data' },
      { status: 500 }
    );
  }
}