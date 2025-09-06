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
      // Use same logic as summary to get all buyers in the period
      const allBuyersQuery = `
        WITH period_buyers AS (
          SELECT 
            shareholder_id,
            s3.name as shareholder_name,
            SUM(
              (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) -
              (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1)
            ) as total_increase,
            MIN(
              (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1)
            ) as first_shares,
            MAX(
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
            SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1
          ) > (
            SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1
          )
          GROUP BY shareholder_id, s3.name
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
      // Use same SQL query as trend data but for specific date
      const filterQuery = `
        WITH daily_buyers AS (
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
          WHERE date = '${buyerDateFilter}'
          GROUP BY shareholder_id, s3.name
          HAVING record_count > 1 AND last_shares > first_shares
        )
        SELECT 
          shareholder_id,
          shareholder_name,
          first_shares,
          last_shares,
          (last_shares - first_shares) as increase_amount
        FROM daily_buyers
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

    // Calculate summary statistics - count unique people who bought in the period
    const summaryQuery = `
      WITH period_buyers AS (
        SELECT DISTINCT
          shareholder_id,
          SUM(
            (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) -
            (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1)
          ) as total_bought,
          MAX(
            (SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1)
          ) as final_shares
        FROM shareholdings s1
        WHERE date >= '${startDate}' AND date <= '${endDate}'
        AND (
          SELECT COUNT(*) FROM shareholdings s3 
          WHERE s3.shareholder_id = s1.shareholder_id AND s3.date = s1.date
        ) > 1
        AND (
          SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1
        ) > (
          SELECT s2.shares_amount FROM shareholdings s2 WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date ORDER BY s2.created_at ASC, s2.id ASC LIMIT 1
        )
        GROUP BY shareholder_id
      )
      SELECT 
        COUNT(shareholder_id) as totalActiveBuyers,
        SUM(total_bought) as totalSharesAccumulated,
        AVG(total_bought) as averageIncrease
      FROM period_buyers
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
    
    // Get daily/monthly trend data using exact buyerDateFilter logic in SQL
    const dateFormat = periodType === 'monthly' ? 'DATE_FORMAT(date, "%Y-%m")' : 'date';
    
    const trendQuery = `
      WITH daily_buyers AS (
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
        HAVING record_count > 1 AND last_shares > first_shares
      )
      SELECT 
        period as date,
        COUNT(shareholder_id) as activeBuyers,
        SUM(last_shares - first_shares) as sharesAccumulated
      FROM daily_buyers
      GROUP BY period
      ORDER BY period
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