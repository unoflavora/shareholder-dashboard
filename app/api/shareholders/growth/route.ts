import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings } from '@/lib/db/schema';
import { eq, and, gte, lte, sql, like } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const searchParams = req.nextUrl.searchParams;
    const shareholderId = searchParams.get('shareholderId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search');

    // If searching by name, get matching shareholders
    if (search && !shareholderId) {
      const matchingShareholders = await db
        .select({
          id: shareholders.id,
          name: shareholders.name,
        })
        .from(shareholders)
        .where(like(shareholders.name, `%${search}%`))
        .limit(10);

      return NextResponse.json({ 
        searchResults: matchingShareholders,
        growthData: null 
      });
    }

    // If no shareholderId, return empty
    if (!shareholderId) {
      return NextResponse.json({ 
        searchResults: [],
        growthData: null 
      });
    }

    // Build conditions for date filtering
    const conditions = [eq(shareholdings.shareholderId, parseInt(shareholderId))];
    
    if (startDate) {
      conditions.push(gte(shareholdings.date, startDate));
    }
    
    if (endDate) {
      conditions.push(lte(shareholdings.date, endDate));
    }

    // Get shareholder info
    const [shareholderInfo] = await db
      .select()
      .from(shareholders)
      .where(eq(shareholders.id, parseInt(shareholderId)))
      .limit(1);

    if (!shareholderInfo) {
      return NextResponse.json(
        { error: 'Shareholder not found' },
        { status: 404 }
      );
    }

    // Get growth data
    const growthData = await db
      .select({
        date: shareholdings.date,
        shares: shareholdings.sharesAmount,
        percentage: shareholdings.percentage,
      })
      .from(shareholdings)
      .where(and(...conditions))
      .orderBy(shareholdings.date);

    // Calculate growth metrics
    let growthMetrics = null;
    if (growthData.length > 1) {
      const firstRecord = growthData[0];
      const lastRecord = growthData[growthData.length - 1];
      
      const sharesChange = lastRecord.shares - firstRecord.shares;
      const sharesChangePercent = firstRecord.shares > 0 
        ? ((sharesChange / firstRecord.shares) * 100).toFixed(2)
        : 0;
      
      const percentageChange = lastRecord.percentage - firstRecord.percentage;

      growthMetrics = {
        initialShares: firstRecord.shares,
        finalShares: lastRecord.shares,
        sharesChange,
        sharesChangePercent: parseFloat(sharesChangePercent as string),
        initialPercentage: firstRecord.percentage,
        finalPercentage: lastRecord.percentage,
        percentageChange: parseFloat(percentageChange.toFixed(4)),
        dateRange: {
          start: firstRecord.date,
          end: lastRecord.date,
        },
      };
    }

    return NextResponse.json({
      shareholder: {
        id: shareholderInfo.id,
        name: shareholderInfo.name,
      },
      growthData: growthData.map(d => ({
        date: d.date,
        shares: d.shares,
        percentage: d.percentage,
      })),
      metrics: growthMetrics,
    });
  } catch (error) {
    console.error('Error fetching shareholder growth:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shareholder growth data' },
      { status: 500 }
    );
  }
}