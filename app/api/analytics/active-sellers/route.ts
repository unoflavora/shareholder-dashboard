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

    // Apply seller date filter if provided, otherwise use same logic as summary
    let filteredSellers = activeSellers;
    if (!sellerDateFilter) {
      // Use same logic as summary to get all sellers in the period
      const allSellersQuery = `
        WITH period_sellers AS (
          SELECT 
            shareholder_id,
            s3.name as shareholder_name,
            SUM(
              (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1) -
              (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1)
            ) as total_decrease,
            MIN(
              (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1)
            ) as first_shares,
            MIN(
              (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1)
            ) as final_shares,
            MIN(date) as first_date,
            MAX(date) as last_date
          FROM shareholdings s1
          JOIN shareholders s3 ON s1.shareholder_id = s3.id
          WHERE date >= '${startDate}' AND date <= '${endDate}'
          AND (
            SELECT COUNT(*) FROM shareholdings s4 
            WHERE s4.shareholder_id = s1.shareholder_id AND s4.date = s1.date
          ) > 1
          AND (
            SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1
          ) > (
            SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1
          )
          GROUP BY shareholder_id, s3.name
          HAVING total_decrease > 0
        )
        SELECT 
          shareholder_id,
          shareholder_name,
          first_shares,
          final_shares,
          total_decrease,
          first_date,
          last_date
        FROM period_sellers
        ORDER BY total_decrease DESC
      `;

      const allSellersResults = await db.execute(sql.raw(allSellersQuery));
      const allSellersRows = allSellersResults[0] || [];
      
      filteredSellers = allSellersRows.map(row => ({
        shareholderId: row.shareholder_id,
        name: row.shareholder_name,
        initialShares: row.first_shares,
        finalShares: row.final_shares,
        totalDecrease: row.total_decrease,
        decreasePercent: row.first_shares > 0 ? ((row.total_decrease / row.first_shares) * 100).toFixed(2) : '100',
        initialOwnership: 0, // Would need calculation if needed
        finalOwnership: 0, // Would need calculation if needed
        ownershipChange: 0, // Would need calculation if needed
        exitStatus: row.final_shares === 0 ? 'Full Exit' : 'Partial Exit',
        sellingDays: 1, // Could be calculated if needed
        averageDecreasePerSell: row.total_decrease,
        firstDate: row.first_date,
        lastDate: row.last_date,
        sellingActivity: [{
          date: row.last_date,
          decrease: row.total_decrease,
          newTotal: row.final_shares
        }]
      }));
    }
    if (sellerDateFilter) {
      // Use same SQL query as trend data but for specific date
      const filterQuery = `
        WITH daily_sellers AS (
          SELECT 
            shareholder_id,
            s3.name as shareholder_name,
            (
              SELECT s2.shares_amount 
              FROM shareholdings s2 
              WHERE s2.shareholder_id = s1.shareholder_id 
              AND s2.date = s1.date 
              ORDER BY s2.created_at ASC, s2.id ASC 
              LIMIT 1
            ) as first_shares,
            (
              SELECT s2.shares_amount 
              FROM shareholdings s2 
              WHERE s2.shareholder_id = s1.shareholder_id 
              AND s2.date = s1.date 
              ORDER BY s2.created_at DESC, s2.id DESC 
              LIMIT 1
            ) as last_shares,
            COUNT(*) as record_count
          FROM shareholdings s1
          JOIN shareholders s3 ON s1.shareholder_id = s3.id
          WHERE date = '${sellerDateFilter}'
          GROUP BY shareholder_id, s3.name
          HAVING record_count > 1 AND first_shares > last_shares
        )
        SELECT 
          shareholder_id,
          shareholder_name,
          first_shares,
          last_shares,
          (first_shares - last_shares) as decrease_amount
        FROM daily_sellers
        ORDER BY decrease_amount DESC
      `;

      const filterResults = await db.execute(sql.raw(filterQuery));
      const filterRows = filterResults[0] || [];
      
      filteredSellers = filterRows.map(row => ({
        shareholderId: row.shareholder_id,
        name: row.shareholder_name,
        initialShares: row.first_shares,
        finalShares: row.last_shares,
        totalDecrease: row.decrease_amount,
        decreasePercent: row.first_shares > 0 ? ((row.decrease_amount / row.first_shares) * 100).toFixed(2) : '100',
        initialOwnership: 0, // Would need calculation if needed
        finalOwnership: 0, // Would need calculation if needed
        ownershipChange: 0, // Would need calculation if needed
        exitStatus: row.last_shares === 0 ? 'Full Exit' : 'Partial Exit',
        sellingDays: 1,
        averageDecreasePerSell: row.decrease_amount,
        firstDate: sellerDateFilter,
        lastDate: sellerDateFilter,
        sellingActivity: [{
          date: sellerDateFilter,
          decrease: row.decrease_amount,
          newTotal: row.last_shares
        }]
      }));
    }

    // Calculate pagination
    const totalSellers = filteredSellers.length;
    const totalPages = Math.ceil(totalSellers / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedSellers = filteredSellers.slice(startIndex, endIndex);

    // Calculate summary statistics - count unique people who sold in the period
    const summaryQuery = `
      WITH period_sellers AS (
        SELECT DISTINCT
          shareholder_id,
          SUM(
            (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1) -
            (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1)
          ) as total_sold,
          MIN(
            (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1)
          ) as final_shares
        FROM shareholdings s1
        WHERE date >= '${startDate}' AND date <= '${endDate}'
        AND (
          SELECT COUNT(*) FROM shareholdings s3 
          WHERE s3.shareholder_id = s1.shareholder_id AND s3.date = s1.date
        ) > 1
        AND (
          SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1
        ) > (
          SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1
        )
        GROUP BY shareholder_id
      )
      SELECT 
        COUNT(shareholder_id) as totalActiveSellers,
        SUM(total_sold) as totalSharesSold,
        SUM(CASE WHEN final_shares = 0 THEN 1 ELSE 0 END) as fullExits,
        SUM(CASE WHEN final_shares > 0 THEN 1 ELSE 0 END) as partialExits
      FROM period_sellers
    `;

    const summaryResults = await db.execute(sql.raw(summaryQuery));
    const summaryData = summaryResults[0]?.[0] || {
      totalActiveSellers: 0,
      totalSharesSold: 0,
      fullExits: 0,
      partialExits: 0
    };

    const totalActiveSellers = Number(summaryData.totalActiveSellers);
    const totalSharesSold = Number(summaryData.totalSharesSold);
    const fullExits = Number(summaryData.fullExits);
    const partialExits = Number(summaryData.partialExits);
    const averageDecrease = totalActiveSellers > 0 ? Math.round(totalSharesSold / totalActiveSellers) : 0;
    
    // Get daily/monthly trend data using exact sellerDateFilter logic in SQL
    const dateFormat = periodType === 'monthly' ? 'DATE_FORMAT(date, "%Y-%m")' : 'date';
    
    const trendQuery = `
      WITH daily_sellers AS (
        SELECT 
          ${dateFormat} as period,
          shareholder_id,
          (
            SELECT s2.shares_amount 
            FROM shareholdings s2 
            WHERE s2.shareholder_id = s1.shareholder_id 
            AND s2.date = s1.date 
            ORDER BY s2.created_at ASC, s2.id ASC 
            LIMIT 1
          ) as first_shares,
          (
            SELECT s2.shares_amount 
            FROM shareholdings s2 
            WHERE s2.shareholder_id = s1.shareholder_id 
            AND s2.date = s1.date 
            ORDER BY s2.created_at DESC, s2.id DESC 
            LIMIT 1
          ) as last_shares,
          COUNT(*) as record_count
        FROM shareholdings s1
        WHERE date >= '${startDate}' AND date <= '${endDate}'
        GROUP BY shareholder_id, date, period
        HAVING record_count > 1 AND first_shares > last_shares
      )
      SELECT 
        period as date,
        COUNT(shareholder_id) as activeSellers,
        SUM(first_shares - last_shares) as sharesSold,
        SUM(CASE WHEN last_shares = 0 THEN 1 ELSE 0 END) as fullExits,
        SUM(CASE WHEN last_shares > 0 THEN 1 ELSE 0 END) as partialExits
      FROM daily_sellers
      GROUP BY period
      ORDER BY period
    `;

    const trendResults = await db.execute(sql.raw(trendQuery));
    
    // Extract actual data from the result structure
    const rawRows = trendResults[0] || [];
    const trendData = rawRows.map(row => ({
      date: row.date,
      activeSellers: Number(row.activeSellers),
      sharesSold: Number(row.sharesSold),
      fullExits: Number(row.fullExits),
      partialExits: Number(row.partialExits)
    }));

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