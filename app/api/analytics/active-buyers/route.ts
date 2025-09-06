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
      // Much faster query using window functions
      const allBuyersQuery = `
        WITH daily_data AS (
          SELECT 
            s1.shareholder_id,
            s3.name as shareholder_name,
            s1.date,
            MAX(s1.shares_amount) as shares_amount,
            LAG(MAX(s1.shares_amount)) OVER (PARTITION BY s1.shareholder_id ORDER BY s1.date) as prev_shares
          FROM shareholdings s1
          JOIN shareholders s3 ON s1.shareholder_id = s3.id
          WHERE s1.date BETWEEN DATE_SUB('${startDate}', INTERVAL 30 DAY) AND '${endDate}'
          GROUP BY s1.shareholder_id, s3.name, s1.date
        ),
        buyer_changes AS (
          SELECT 
            shareholder_id,
            shareholder_name,
            SUM(CASE 
              WHEN date >= '${startDate}' AND shares_amount > COALESCE(prev_shares, 0)
              THEN shares_amount - COALESCE(prev_shares, 0)
              ELSE 0 
            END) as total_increase,
            MAX(CASE WHEN date >= '${startDate}' AND date <= '${endDate}' THEN shares_amount END) as final_shares,
            MIN(CASE WHEN date >= '${startDate}' THEN prev_shares END) as initial_shares,
            MIN(CASE WHEN date >= '${startDate}' THEN date END) as first_date,
            MAX(CASE WHEN date >= '${startDate}' AND date <= '${endDate}' THEN date END) as last_date
          FROM daily_data
          GROUP BY shareholder_id, shareholder_name
          HAVING total_increase > 0
        )
        SELECT * FROM buyer_changes 
        ORDER BY total_increase DESC
      `;

      const allBuyersResults = await db.execute(sql.raw(allBuyersQuery));
      const allBuyersRows = allBuyersResults[0] || [];
      
      filteredBuyers = allBuyersRows.map(row => {
        const finalShares = Number(row.final_shares);
        const totalIncrease = Number(row.total_increase);
        const initialShares = Number(row.initial_shares) || 0;
        
        return {
          shareholderId: Number(row.shareholder_id),
          name: row.shareholder_name,
          initialShares: initialShares,
          finalShares: finalShares,
          totalIncrease: totalIncrease,
          increasePercent: initialShares > 0 ? ((totalIncrease / initialShares) * 100).toFixed(2) : '100',
          initialOwnership: 0,
          finalOwnership: 0,
          ownershipChange: 0,
          buyingDays: 1,
          averageIncreasePerBuy: totalIncrease,
          firstDate: row.first_date,
          lastDate: row.last_date,
          buyingActivity: [{
            date: row.last_date,
            increase: totalIncrease,
            newTotal: finalShares
          }]
        };
      });
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
      
      filteredBuyers = filterRows.map(row => {
        const finalShares = Number(row.last_shares);
        const totalIncrease = Number(row.increase_amount);
        const initialShares = Number(row.first_shares);
        
        return {
          shareholderId: row.shareholder_id,
          name: row.shareholder_name,
          initialShares: initialShares,
          finalShares: finalShares,
          totalIncrease: totalIncrease,
            increasePercent: initialShares > 0 ? ((totalIncrease / initialShares) * 100).toFixed(2) : '100',
          initialOwnership: 0, // Would need calculation if needed
          finalOwnership: 0, // Would need calculation if needed
          ownershipChange: 0, // Would need calculation if needed
          buyingDays: 1,
          averageIncreasePerBuy: totalIncrease,
          firstDate: buyerDateFilter,
          lastDate: buyerDateFilter,
          buyingActivity: [{
            date: buyerDateFilter,
            increase: totalIncrease,
            newTotal: finalShares
          }]
        };
      });
    }

    // Calculate pagination
    const totalBuyers = filteredBuyers.length;
    const totalPages = Math.ceil(totalBuyers / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedBuyers = filteredBuyers.slice(startIndex, endIndex);

    // Fast summary query using same logic as main query  
    const summaryQuery = `
      WITH daily_data AS (
        SELECT 
          s1.shareholder_id,
          s1.date,
          MAX(s1.shares_amount) as shares_amount,
          LAG(MAX(s1.shares_amount)) OVER (PARTITION BY s1.shareholder_id ORDER BY s1.date) as prev_shares
        FROM shareholdings s1
        WHERE s1.date BETWEEN DATE_SUB('${startDate}', INTERVAL 30 DAY) AND '${endDate}'
        GROUP BY s1.shareholder_id, s1.date
      ),
      buyer_summary AS (
        SELECT 
          shareholder_id,
          SUM(CASE 
            WHEN date >= '${startDate}' AND shares_amount > COALESCE(prev_shares, 0)
            THEN shares_amount - COALESCE(prev_shares, 0)
            ELSE 0 
          END) as total_increase
        FROM daily_data
        GROUP BY shareholder_id
        HAVING total_increase > 0
      )
      SELECT 
        COUNT(shareholder_id) as totalActiveBuyers,
        SUM(total_increase) as totalSharesAccumulated,
        AVG(total_increase) as averageIncrease
      FROM buyer_summary
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