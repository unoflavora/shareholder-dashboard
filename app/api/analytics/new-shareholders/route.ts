import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholdings, shareholders } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

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
    const entryDateFilter = searchParams.get('entryDateFilter');

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    // Apply entry date filter if provided, otherwise use same logic as summary
    let filteredNewBuyers = [];
    if (!entryDateFilter) {
      // Get all new entry buyers in the period (people with initialShares = 0)
      const allNewBuyersQuery = `
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
          WHERE s1.date <= '${endDate}'
          GROUP BY s1.shareholder_id, s1.date, s3.name
        ),
        new_entry_buyers AS (
          SELECT 
            dp.shareholder_id,
            dp.shareholder_name,
            MIN(dp.date) as first_buy_date,
            MIN(dp.latest_shares) as first_shares,
            MAX(dp.latest_shares) as final_shares,
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
            ) as total_bought
          FROM daily_positions dp
          WHERE NOT EXISTS (
            SELECT 1 FROM shareholdings s_prev
            WHERE s_prev.shareholder_id = dp.shareholder_id
            AND s_prev.date < '${startDate}'
            AND s_prev.shares_amount > 0
          )
          GROUP BY dp.shareholder_id, dp.shareholder_name
          HAVING total_bought > 0
        )
        SELECT 
          shareholder_id,
          shareholder_name,
          first_buy_date,
          first_shares,
          final_shares,
          total_bought
        FROM new_entry_buyers
        WHERE first_shares = 0 OR NOT EXISTS (
          SELECT 1 FROM shareholdings s_check
          WHERE s_check.shareholder_id = new_entry_buyers.shareholder_id
          AND s_check.date < first_buy_date
          AND s_check.shares_amount > 0
        )
        ORDER BY total_bought DESC
      `;

      const allNewBuyersResults = await db.execute(sql.raw(allNewBuyersQuery));
      const allNewBuyersRows = allNewBuyersResults[0] || [];
      
      filteredNewBuyers = allNewBuyersRows.map(row => ({
        shareholderId: Number(row.shareholder_id),
        name: row.shareholder_name,
        entryDate: row.first_buy_date,
        initialShares: 0, // Always 0 for new entry buyers
        currentShares: Number(row.final_shares),
        growthSinceEntry: Number(row.total_bought), // Amount they bought since entry
        growthPercent: '100', // Always 100% since they started from 0
        initialOwnership: 0,
        finalOwnership: 0, // Would need calculation if needed
        currentOwnership: 0, // Would need calculation if needed
        ownershipChange: 0, // Would need calculation if needed
        daysActive: 1, // Could be calculated if needed
        trajectory: 'Accumulating', // New buyers are accumulating
        firstBuyDate: row.first_buy_date,
        buyingActivity: [{
          date: row.first_buy_date,
          bought: Number(row.total_bought),
          newTotal: Number(row.final_shares)
        }]
      }));
    }
    
    if (entryDateFilter) {
      // Get new entry buyers for specific date
      const filterQuery = `
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
          GROUP BY s1.shareholder_id, s1.date, s3.name
        ),
        daily_new_buyers AS (
          SELECT 
            dp.shareholder_id,
            dp.shareholder_name,
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
            END as bought_amount
          FROM daily_positions dp
          WHERE dp.date = '${entryDateFilter}'
            AND NOT EXISTS (
              SELECT 1 FROM shareholdings s_prev
              WHERE s_prev.shareholder_id = dp.shareholder_id
              AND s_prev.date < '${entryDateFilter}'
              AND s_prev.shares_amount > 0
            )
        )
        SELECT 
          shareholder_id,
          shareholder_name,
          current_shares,
          bought_amount
        FROM daily_new_buyers
        WHERE bought_amount > 0
        ORDER BY bought_amount DESC
      `;

      const filterResults = await db.execute(sql.raw(filterQuery));
      const filterRows = filterResults[0] || [];
      
      filteredNewBuyers = filterRows.map(row => ({
        shareholderId: Number(row.shareholder_id),
        name: row.shareholder_name,
        entryDate: entryDateFilter,
        initialShares: 0, // Always 0 for new entry buyers
        currentShares: Number(row.current_shares),
        growthSinceEntry: Number(row.bought_amount), // Amount they bought since entry
        growthPercent: '100', // Always 100% since they started from 0
        initialOwnership: 0,
        finalOwnership: 0, // Would need calculation if needed
        currentOwnership: 0, // Would need calculation if needed
        ownershipChange: 0, // Would need calculation if needed
        daysActive: 1, // Could be calculated if needed
        trajectory: 'Accumulating', // New buyers are accumulating
        firstBuyDate: entryDateFilter,
        buyingActivity: [{
          date: entryDateFilter,
          bought: Number(row.bought_amount),
          newTotal: Number(row.current_shares)
        }]
      }));
    }

    // Calculate pagination
    const totalNewBuyers = filteredNewBuyers.length;
    const totalPages = Math.ceil(totalNewBuyers / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedNewBuyers = filteredNewBuyers.slice(startIndex, endIndex);

    // Calculate summary statistics based on filtered results
    let summaryQuery;
    if (entryDateFilter) {
      // If filtering by specific date, use the same logic as filter query for summary
      summaryQuery = `
        WITH daily_positions AS (
          SELECT 
            shareholder_id,
            date,
            (SELECT s2.shares_amount FROM shareholdings s2 
             WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date 
             ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) as latest_shares
          FROM shareholdings s1
          GROUP BY shareholder_id, date
        ),
        daily_new_buyers AS (
          SELECT 
            dp.shareholder_id,
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
            END as bought_amount
          FROM daily_positions dp
          WHERE dp.date = '${entryDateFilter}'
            AND NOT EXISTS (
              SELECT 1 FROM shareholdings s_prev
              WHERE s_prev.shareholder_id = dp.shareholder_id
              AND s_prev.date < '${entryDateFilter}'
              AND s_prev.shares_amount > 0
            )
        )
        SELECT 
          COUNT(CASE WHEN bought_amount > 0 THEN shareholder_id END) as totalNewBuyers,
          SUM(bought_amount) as totalSharesBought,
          AVG(CASE WHEN bought_amount > 0 THEN bought_amount END) as averageBought
        FROM daily_new_buyers
      `;
    } else {
      // Use full period logic for summary
      summaryQuery = `
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
        new_buyers_with_changes AS (
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
          WHERE NOT EXISTS (
            SELECT 1 FROM shareholdings s_prev
            WHERE s_prev.shareholder_id = dp.shareholder_id
            AND s_prev.date < '${startDate}'
            AND s_prev.shares_amount > 0
          )
          GROUP BY dp.shareholder_id
          HAVING total_bought > 0
        )
        SELECT 
          COUNT(shareholder_id) as totalNewBuyers,
          SUM(total_bought) as totalSharesBought,
          AVG(total_bought) as averageBought
        FROM new_buyers_with_changes
      `;
    }

    const summaryResults = await db.execute(sql.raw(summaryQuery));
    const summaryData = summaryResults[0]?.[0] || {
      totalNewBuyers: 0,
      totalSharesBought: 0,
      averageBought: 0
    };

    const totalNewBuyersCount = Number(summaryData.totalNewBuyers);
    const totalSharesBought = Number(summaryData.totalSharesBought);
    const averageBought = Math.round(Number(summaryData.averageBought) || 0);
    
    // Get daily/monthly trend data using same logic
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
        WHERE date >= '${startDate}' AND date <= '${endDate}'
        GROUP BY shareholder_id, date, period
      ),
      all_dates AS (
        SELECT DISTINCT period as date
        FROM daily_positions
        ORDER BY period
      ),
      daily_new_buyers AS (
        SELECT 
          dp.period,
          dp.date,
          dp.shareholder_id,
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
          END as bought_amount
        FROM daily_positions dp
        WHERE NOT EXISTS (
          SELECT 1 FROM shareholdings s_prev
          WHERE s_prev.shareholder_id = dp.shareholder_id
          AND s_prev.date < dp.date
          AND s_prev.shares_amount > 0
        )
      ),
      new_buyers_by_date AS (
        SELECT 
          period as date,
          COUNT(CASE WHEN bought_amount > 0 THEN shareholder_id END) as newBuyers,
          SUM(bought_amount) as sharesBought
        FROM daily_new_buyers
        GROUP BY period
      )
      SELECT 
        ad.date,
        COALESCE(nbbd.newBuyers, 0) as newBuyers,
        COALESCE(nbbd.sharesBought, 0) as sharesBought
      FROM all_dates ad
      LEFT JOIN new_buyers_by_date nbbd ON ad.date = nbbd.date
      ORDER BY ad.date
    `;

    const trendResults = await db.execute(sql.raw(trendQuery));
    
    // Extract actual data from the result structure
    const rawRows = trendResults[0] || [];
    const trendData = rawRows.map(row => ({
      date: row.date,
      newEntrants: Number(row.newBuyers),
      totalInitialShares: Number(row.sharesBought),
      totalCurrentShares: Number(row.sharesBought), // Same as initial for new buyers
      averageEntry: row.newBuyers > 0 ? Math.round(Number(row.sharesBought) / Number(row.newBuyers)) : 0,
      entrantNames: [] // Empty array since we don't have names in trend data
    }));

    return NextResponse.json({
      summary: {
        totalNewShareholders: totalNewBuyersCount,
        totalInitialInvestment: totalSharesBought,
        totalCurrentHoldings: totalSharesBought, // Same as initial for new buyers
        netChange: 0, // Always 0 for new entry buyers since they start from 0
        averageEntrySize: averageBought,
        trajectories: {
          accumulating: 0, // Not applicable for new entry buyers
          reducing: 0,
          stable: totalNewBuyersCount // All new buyers are "stable" as they just entered
        },
        topNewEntrant: filteredNewBuyers[0] || null,
        period: {
          start: startDate,
          end: endDate,
          type: periodType
        }
      },
      newShareholders: paginatedNewBuyers,
      entryTrendData: trendData,
      pagination: {
        page,
        limit,
        total: totalNewBuyers,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching new entry buyers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch new entry buyers data' },
      { status: 500 }
    );
  }
}