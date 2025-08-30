import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholdings, shareholders } from '@/lib/db/schema';
import { sql, desc, asc } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get trend data over time
    const trendData = await db
      .select({
        date: shareholdings.date,
        totalShareholders: sql<number>`count(distinct ${shareholdings.shareholderId})`,
        totalShares: sql<number>`sum(${shareholdings.sharesAmount})`,
        averageShares: sql<number>`avg(${shareholdings.sharesAmount})`,
      })
      .from(shareholdings)
      .groupBy(shareholdings.date)
      .orderBy(asc(shareholdings.date));

    // Get top shareholders for latest date
    const [latestDate] = await db
      .select({ date: shareholdings.date })
      .from(shareholdings)
      .orderBy(desc(shareholdings.date))
      .limit(1);

    let topShareholders: any[] = [];
    if (latestDate?.date) {
      topShareholders = await db
        .select({
          name: shareholders.name,
          accountHolder: shareholders.accountHolder,
          shares: shareholdings.sharesAmount,
          percentage: shareholdings.percentage,
        })
        .from(shareholdings)
        .innerJoin(shareholders, sql`${shareholdings.shareholderId} = ${shareholders.id}`)
        .where(sql`${shareholdings.date} = ${latestDate.date}`)
        .orderBy(desc(shareholdings.sharesAmount))
        .limit(10);
    }

    // Get distribution data (grouping by percentage ranges)
    let distribution: any[] = [];
    if (latestDate?.date) {
      const distributionQuery = await db
        .select({
          range: sql<string>`
            CASE 
              WHEN ${shareholdings.percentage} < 0.1 THEN '< 0.1%'
              WHEN ${shareholdings.percentage} < 0.5 THEN '0.1% - 0.5%'
              WHEN ${shareholdings.percentage} < 1 THEN '0.5% - 1%'
              WHEN ${shareholdings.percentage} < 5 THEN '1% - 5%'
              WHEN ${shareholdings.percentage} < 10 THEN '5% - 10%'
              ELSE '> 10%'
            END
          `.as('range'),
          count: sql<number>`count(*)`,
          totalShares: sql<number>`sum(${shareholdings.sharesAmount})`,
        })
        .from(shareholdings)
        .where(sql`${shareholdings.date} = ${latestDate.date}`)
        .groupBy(sql`
          CASE 
            WHEN ${shareholdings.percentage} < 0.1 THEN '< 0.1%'
            WHEN ${shareholdings.percentage} < 0.5 THEN '0.1% - 0.5%'
            WHEN ${shareholdings.percentage} < 1 THEN '0.5% - 1%'
            WHEN ${shareholdings.percentage} < 5 THEN '1% - 5%'
            WHEN ${shareholdings.percentage} < 10 THEN '5% - 10%'
            ELSE '> 10%'
          END
        `);

      // Sort the results in memory instead of in SQL
      distribution = distributionQuery.sort((a, b) => {
        const order: Record<string, number> = {
          '< 0.1%': 1,
          '0.1% - 0.5%': 2,
          '0.5% - 1%': 3,
          '1% - 5%': 4,
          '5% - 10%': 5,
          '> 10%': 6,
        };
        return (order[a.range] || 7) - (order[b.range] || 7);
      });
    }

    // Get monthly aggregated data
    const monthlyData = await db
      .select({
        month: sql<string>`substr(${shareholdings.date}, 1, 7)`,
        totalShareholders: sql<number>`count(distinct ${shareholdings.shareholderId})`,
        totalShares: sql<number>`sum(${shareholdings.sharesAmount})`,
        avgShares: sql<number>`avg(${shareholdings.sharesAmount})`,
      })
      .from(shareholdings)
      .groupBy(sql`substr(${shareholdings.date}, 1, 7)`)
      .orderBy(sql`substr(${shareholdings.date}, 1, 7)`);

    return NextResponse.json({
      trends: trendData.map(t => ({
        date: t.date,
        totalShareholders: Number(t.totalShareholders),
        totalShares: Number(t.totalShares),
        averageShares: Math.round(Number(t.averageShares)),
      })),
      topShareholders: topShareholders.map(s => ({
        name: s.name,
        accountHolder: s.accountHolder,
        shares: s.shares,
        percentage: parseFloat(s.percentage as string) || 0,
      })),
      distribution: distribution.map(d => ({
        range: d.range,
        count: Number(d.count),
        totalShares: Number(d.totalShares),
      })),
      monthlyData: monthlyData.map(m => ({
        month: m.month,
        totalShareholders: Number(m.totalShareholders),
        totalShares: Number(m.totalShares),
        avgShares: Math.round(Number(m.avgShares)),
      })),
      latestDate: latestDate?.date,
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics data' },
      { status: 500 }
    );
  }
}