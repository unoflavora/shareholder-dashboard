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

    // Apply seller date filter if provided, otherwise use same logic as summary
    let filteredSellers = [];
    if (!sellerDateFilter) {
      // Use same logic as summary to get all sellers in the period (latest available previous data logic)
      const allSellersQuery = `
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
        period_sellers AS (
          SELECT 
            dp.shareholder_id,
            dp.shareholder_name,
            SUM(
              CASE 
                WHEN COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                             WHERE dp2.shareholder_id = dp.shareholder_id 
                             AND dp2.date < dp.date
                             ORDER BY dp2.date DESC LIMIT 1), 0) > dp.latest_shares
                THEN COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                             WHERE dp2.shareholder_id = dp.shareholder_id 
                             AND dp2.date < dp.date
                             ORDER BY dp2.date DESC LIMIT 1), 0) - dp.latest_shares
                ELSE 0
              END
            ) as total_decrease,
            MIN((SELECT dp2.latest_shares FROM daily_positions dp2 
                 WHERE dp2.shareholder_id = dp.shareholder_id 
                 ORDER BY dp2.date ASC LIMIT 1)) as first_shares,
            MIN(dp.latest_shares) as final_shares,
            MIN(dp.date) as first_date,
            MAX(dp.date) as last_date
          FROM daily_positions dp
          GROUP BY dp.shareholder_id, dp.shareholder_name
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
        WHERE total_decrease > 0
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
        daily_sellers AS (
          SELECT 
            dp.shareholder_id,
            dp.shareholder_name,
            COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                     WHERE dp2.shareholder_id = dp.shareholder_id 
                     AND dp2.date < dp.date
                     ORDER BY dp2.date DESC LIMIT 1), 0) as prev_shares,
            dp.latest_shares as current_shares
          FROM daily_positions dp
          WHERE dp.date = '${sellerDateFilter}'
            AND EXISTS (
              SELECT 1 FROM daily_positions dp_prev 
              WHERE dp_prev.shareholder_id = dp.shareholder_id 
              AND dp_prev.date < dp.date
              AND dp_prev.latest_shares > dp.latest_shares
            )
        )
        SELECT 
          shareholder_id,
          shareholder_name,
          prev_shares as first_shares,
          current_shares as last_shares,
          (prev_shares - current_shares) as decrease_amount
        FROM daily_sellers
        WHERE (prev_shares - current_shares) > 0
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

    // Calculate summary statistics - count unique people who sold in the period (latest available previous data logic)
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
      sellers_with_changes AS (
        SELECT DISTINCT
          dp.shareholder_id,
          SUM(
            CASE 
              WHEN COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                           WHERE dp2.shareholder_id = dp.shareholder_id 
                           AND dp2.date < dp.date
                           ORDER BY dp2.date DESC LIMIT 1), 0) > dp.latest_shares
              THEN COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                           WHERE dp2.shareholder_id = dp.shareholder_id 
                           AND dp2.date < dp.date
                           ORDER BY dp2.date DESC LIMIT 1), 0) - dp.latest_shares
              ELSE 0
            END
          ) as total_sold,
          MIN(dp.latest_shares) as final_shares
        FROM daily_positions dp
        GROUP BY dp.shareholder_id
        HAVING total_sold > 0
      )
      SELECT 
        COUNT(shareholder_id) as totalActiveSellers,
        SUM(total_sold) as totalSharesSold,
        SUM(CASE WHEN final_shares = 0 THEN 1 ELSE 0 END) as fullExits,
        SUM(CASE WHEN final_shares > 0 THEN 1 ELSE 0 END) as partialExits
      FROM sellers_with_changes
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
      daily_sellers AS (
        SELECT 
          dp.period,
          dp.shareholder_id,
          COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                   WHERE dp2.shareholder_id = dp.shareholder_id 
                   AND dp2.date < dp.date
                   ORDER BY dp2.date DESC LIMIT 1), 0) as prev_shares,
          dp.latest_shares as current_shares,
          CASE 
            WHEN COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                         WHERE dp2.shareholder_id = dp.shareholder_id 
                         AND dp2.date < dp.date
                         ORDER BY dp2.date DESC LIMIT 1), 0) > dp.latest_shares
            THEN COALESCE((SELECT dp2.latest_shares FROM daily_positions dp2 
                         WHERE dp2.shareholder_id = dp.shareholder_id 
                         AND dp2.date < dp.date
                         ORDER BY dp2.date DESC LIMIT 1), 0) - dp.latest_shares
            ELSE 0
          END as selling_amount
        FROM daily_positions dp
      ),
      sellers_by_date AS (
        SELECT 
          period as date,
          COUNT(CASE WHEN selling_amount > 0 THEN shareholder_id END) as activeSellers,
          SUM(selling_amount) as sharesSold,
          SUM(CASE WHEN selling_amount > 0 AND current_shares = 0 THEN 1 ELSE 0 END) as fullExits,
          SUM(CASE WHEN selling_amount > 0 AND current_shares > 0 THEN 1 ELSE 0 END) as partialExits
        FROM daily_sellers
        GROUP BY period
      )
      SELECT 
        ad.date,
        COALESCE(sbd.activeSellers, 0) as activeSellers,
        COALESCE(sbd.sharesSold, 0) as sharesSold,
        COALESCE(sbd.fullExits, 0) as fullExits,
        COALESCE(sbd.partialExits, 0) as partialExits
      FROM all_dates ad
      LEFT JOIN sellers_by_date sbd ON ad.date = sbd.date
      ORDER BY ad.date
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
        topSeller: filteredSellers[0] || null,
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