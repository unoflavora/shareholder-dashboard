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
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const buyerDateFilter = searchParams.get('buyerDateFilter');

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    // Apply buyer date filter if provided, otherwise use same logic as summary
    let filteredBuyers = [];
    if (!buyerDateFilter) {
      // Use same logic as summary to get all buyers in the period (latest available previous data logic)
      const allBuyersQuery = `
        WITH daily_positions AS (
          SELECT 
            s1.shareholder_id,
            s1.date,
            s3.name as shareholder_name,
            (SELECT s2.shares_amount FROM shareholdings s2 
             WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date 
             ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) as latest_shares
          FROM shareholdings s1
          JOIN shareholders s3 ON s1.shareholder_id = s3.id
          WHERE s1.date >= '${startDate}' AND s1.date <= '${endDate}'
          GROUP BY s1.shareholder_id, s1.date, s3.name
        ),
        period_buyers AS (
          SELECT 
            dp.shareholder_id,
            dp.shareholder_name,
            SUM(
              CASE 
                WHEN dp.latest_shares > COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                                                WHERE dp2.shareholder_id = dp.shareholder_id 
                                                AND dp2.date < dp.date
                                                ORDER BY dp2.date DESC LIMIT 1), 0)
                THEN dp.latest_shares - COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                                                WHERE dp2.shareholder_id = dp.shareholder_id 
                                                AND dp2.date < dp.date
                                                ORDER BY dp2.date DESC LIMIT 1), 0)
                ELSE 0
              END
            ) as total_increase,
            MIN((SELECT dp2.latest_shares FROM daily_positions dp2 
                 WHERE dp2.shareholder_id = dp.shareholder_id 
                 ORDER BY dp2.date ASC LIMIT 1)) as first_shares,
            MAX(dp.latest_shares) as final_shares,
            MIN(dp.date) as first_date,
            MAX(dp.date) as last_date
          FROM daily_positions dp
          GROUP BY dp.shareholder_id, dp.shareholder_name
          HAVING total_increase > 0
        )
        SELECT 
          shareholder_id,
          shareholder_name,
          first_shares,
          final_shares,
          total_increase,
          first_date,
          last_date
        FROM period_buyers
        WHERE total_increase > 0
        ORDER BY total_increase DESC
      `;

      const allBuyersResults = await db.execute(sql.raw(allBuyersQuery));
      const allBuyersRows = allBuyersResults[0] || [];
      
      filteredBuyers = allBuyersRows.map(row => ({
        shareholderId: row.shareholder_id,
        name: row.shareholder_name,
        initialShares: row.first_shares,
        finalShares: row.final_shares,
        totalIncrease: row.total_increase,
        increasePercent: row.first_shares > 0 ? ((row.total_increase / row.first_shares) * 100).toFixed(2) : '100',
        initialOwnership: 0, // Would need calculation if needed
        finalOwnership: 0, // Would need calculation if needed
        ownershipChange: 0, // Would need calculation if needed
        buyingDays: 1, // Could be calculated if needed
        averageIncreasePerBuy: row.total_increase,
        firstDate: row.first_date,
        lastDate: row.last_date,
        buyingActivity: [{
          date: row.last_date,
          increase: row.total_increase,
          newTotal: row.final_shares
        }]
      }));
    }
    if (buyerDateFilter) {
      // Use same logic as trend query but filtered for specific date
      const filterQuery = `
        WITH daily_positions AS (
          SELECT 
            shareholder_id,
            date,
            s3.name as shareholder_name,
            (SELECT s2.shares_amount FROM shareholdings s2 
             WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date 
             ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) as latest_shares
          FROM shareholdings s1
          JOIN shareholders s3 ON s1.shareholder_id = s3.id
          WHERE date <= '${endDate}'
          GROUP BY shareholder_id, date, s3.name
        ),
        daily_buyers AS (
          SELECT 
            dp.shareholder_id,
            dp.shareholder_name,
            COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                     WHERE dp2.shareholder_id = dp.shareholder_id 
                     AND dp2.date < dp.date
                     ORDER BY dp2.date DESC LIMIT 1), 0) as prev_shares,
            dp.latest_shares as current_shares,
            CASE 
              WHEN dp.latest_shares > COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                                              WHERE dp2.shareholder_id = dp.shareholder_id 
                                              AND dp2.date < dp.date
                                              ORDER BY dp2.date DESC LIMIT 1), 0)
              THEN dp.latest_shares - COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                                              WHERE dp2.shareholder_id = dp.shareholder_id 
                                              AND dp2.date < dp.date
                                              ORDER BY dp2.date DESC LIMIT 1), 0)
              ELSE 0
            END as buying_amount
          FROM daily_positions dp
          WHERE dp.date = '${buyerDateFilter}'
        )
        SELECT 
          shareholder_id,
          shareholder_name,
          prev_shares as first_shares,
          current_shares as last_shares,
          buying_amount as increase_amount
        FROM daily_buyers
        WHERE buying_amount > 0
        ORDER BY increase_amount DESC
      `;

      const filterResults = await db.execute(sql.raw(filterQuery));
      const filterRows = filterResults[0] || [];
      
      filteredBuyers = filterRows.map(row => ({
        shareholderId: row.shareholder_id,
        name: row.shareholder_name,
        initialShares: row.first_shares,
        finalShares: row.last_shares,
        totalIncrease: row.increase_amount,
        increasePercent: row.first_shares > 0 ? ((row.increase_amount / row.first_shares) * 100).toFixed(2) : '100',
        initialOwnership: 0, // Would need calculation if needed
        finalOwnership: 0, // Would need calculation if needed
        ownershipChange: 0, // Would need calculation if needed
        buyingDays: 1,
        averageIncreasePerBuy: row.increase_amount,
        firstDate: buyerDateFilter,
        lastDate: buyerDateFilter,
        buyingActivity: [{
          date: buyerDateFilter,
          increase: row.increase_amount,
          newTotal: row.last_shares
        }]
      }));
    }

    // Calculate pagination
    const totalBuyers = filteredBuyers.length;
    const totalPages = Math.ceil(totalBuyers / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedBuyers = filteredBuyers.slice(startIndex, endIndex);

    // Calculate summary statistics - count unique people who bought in the period (latest available previous data logic)
    const summaryQuery = `
      WITH daily_positions AS (
        SELECT 
          shareholder_id,
          date,
          (SELECT s2.shares_amount FROM shareholdings s2 
           WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date 
           ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) as latest_shares
        FROM shareholdings s1
        WHERE date >= '${startDate}' AND date <= '${endDate}'
        GROUP BY shareholder_id, date
      ),
      buyers_with_changes AS (
        SELECT DISTINCT
          dp.shareholder_id,
          SUM(
            CASE 
              WHEN dp.latest_shares > COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                                              WHERE dp2.shareholder_id = dp.shareholder_id 
                                              AND dp2.date < dp.date
                                              ORDER BY dp2.date DESC LIMIT 1), 0)
              THEN dp.latest_shares - COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                                              WHERE dp2.shareholder_id = dp.shareholder_id 
                                              AND dp2.date < dp.date
                                              ORDER BY dp2.date DESC LIMIT 1), 0)
              ELSE 0
            END
          ) as total_bought,
          MAX(dp.latest_shares) as final_shares
        FROM daily_positions dp
        GROUP BY dp.shareholder_id
        HAVING total_bought > 0
      )
      SELECT 
        COUNT(shareholder_id) as totalActiveBuyers,
        SUM(total_bought) as totalSharesAccumulated,
        AVG(total_bought) as averageIncrease
      FROM buyers_with_changes
    `;

    const summaryResults = await db.execute(sql.raw(summaryQuery));
    const summaryData = summaryResults[0]?.[0] || {
      totalActiveBuyers: 0,
      totalSharesAccumulated: 0,
      averageIncrease: 0
    };

    const totalActiveBuyers = Number(summaryData.totalActiveBuyers);
    const totalSharesAccumulated = Number(summaryData.totalSharesAccumulated);
    const averageIncrease = Math.round(Number(summaryData.averageIncrease) || 0);
    
    // Get daily/monthly trend data using latest available previous data logic
    const dateFormat = periodType === 'monthly' ? 'DATE_FORMAT(date, "%Y-%m")' : 'date';
    
    const trendQuery = `
      WITH daily_positions AS (
        SELECT 
          shareholder_id,
          date,
          ${dateFormat} as period,
          (SELECT s2.shares_amount FROM shareholdings s2 
           WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date 
           ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) as latest_shares
        FROM shareholdings s1
        WHERE date <= '${endDate}'
        GROUP BY shareholder_id, date, period
      ),
      all_dates AS (
        SELECT DISTINCT period as date
        FROM daily_positions
        WHERE period >= '${startDate}' 
        ORDER BY period
      ),
      daily_buyers AS (
        SELECT 
          dp.period,
          dp.shareholder_id,
          COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                   WHERE dp2.shareholder_id = dp.shareholder_id 
                   AND dp2.date < dp.date
                   ORDER BY dp2.date DESC LIMIT 1), 0) as prev_shares,
          dp.latest_shares as current_shares,
          CASE 
            WHEN dp.latest_shares > COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                                            WHERE dp2.shareholder_id = dp.shareholder_id 
                                            AND dp2.date < dp.date
                                            ORDER BY dp2.date DESC LIMIT 1), 0)
            THEN dp.latest_shares - COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                                            WHERE dp2.shareholder_id = dp.shareholder_id 
                                            AND dp2.date < dp.date
                                            ORDER BY dp2.date DESC LIMIT 1), 0)
            ELSE 0
          END as buying_amount
        FROM daily_positions dp
      ),
      buyers_by_date AS (
        SELECT 
          period as date,
          COUNT(CASE WHEN buying_amount > 0 THEN shareholder_id END) as activeBuyers,
          SUM(buying_amount) as sharesAccumulated
        FROM daily_buyers
        GROUP BY period
      )
      SELECT 
        ad.date,
        COALESCE(bbd.activeBuyers, 0) as activeBuyers,
        COALESCE(bbd.sharesAccumulated, 0) as sharesAccumulated
      FROM all_dates ad
      LEFT JOIN buyers_by_date bbd ON ad.date = bbd.date
      ORDER BY ad.date
    `;

    const trendResults = await db.execute(sql.raw(trendQuery));
    
    // Extract actual data from the result structure
    const rawRows = trendResults[0] || [];
    const trendData = rawRows.map(row => ({
      date: row.date,
      activeBuyers: Number(row.activeBuyers),
      sharesAccumulated: Number(row.sharesAccumulated)
    }));

    return NextResponse.json({
      summary: {
        totalActiveBuyers,
        totalSharesAccumulated,
        averageIncrease,
        topAccumulator: filteredBuyers[0] || null,
        period: {
          start: startDate,
          end: endDate,
          type: periodType
        }
      },
      buyers: paginatedBuyers,
      trendData,
      pagination: {
        page,
        limit,
        total: totalBuyers,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching active buyers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active buyers data' },
      { status: 500 }
    );
  }
}