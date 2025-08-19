import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings, uploads } from '@/lib/db/schema';
import { sql, desc, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get total shareholders count
    const [shareholderCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(shareholders);

    // Get latest date with data
    const [latestDate] = await db
      .select({ date: shareholdings.date })
      .from(shareholdings)
      .orderBy(desc(shareholdings.date))
      .limit(1);

    // Get total shares and shareholders for latest date
    let totalShares = 0;
    let activeShareholdersCount = 0;
    
    if (latestDate?.date) {
      const [sharesResult] = await db
        .select({ 
          totalShares: sql<number>`COALESCE(SUM(${shareholdings.sharesAmount}), 0)`,
          count: sql<number>`count(*)`
        })
        .from(shareholdings)
        .where(eq(shareholdings.date, latestDate.date));
      
      totalShares = sharesResult?.totalShares || 0;
      activeShareholdersCount = sharesResult?.count || 0;
    }

    // Get last upload info
    const [lastUpload] = await db
      .select({
        uploadDate: uploads.uploadDate,
        filename: uploads.filename,
        recordsCount: uploads.recordsCount,
      })
      .from(uploads)
      .orderBy(desc(uploads.createdAt))
      .limit(1);

    // Get total uploads count
    const [uploadCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(uploads);

    // Get comparison with previous date if exists
    let previousDateStats = null;
    if (latestDate?.date) {
      const [previousDate] = await db
        .select({ date: shareholdings.date })
        .from(shareholdings)
        .where(sql`${shareholdings.date} < ${latestDate.date}`)
        .orderBy(desc(shareholdings.date))
        .limit(1);

      if (previousDate?.date) {
        const [prevStats] = await db
          .select({ 
            totalShares: sql<number>`COALESCE(SUM(${shareholdings.sharesAmount}), 0)`,
            count: sql<number>`count(*)`
          })
          .from(shareholdings)
          .where(eq(shareholdings.date, previousDate.date));

        previousDateStats = {
          date: previousDate.date,
          totalShares: prevStats?.totalShares || 0,
          shareholdersCount: prevStats?.count || 0,
        };
      }
    }

    return NextResponse.json({
      totalShareholders: shareholderCount?.count || 0,
      activeShareholders: activeShareholdersCount,
      totalShares,
      lastUpload: lastUpload ? {
        date: lastUpload.uploadDate,
        fileName: lastUpload.filename,
        recordCount: lastUpload.recordsCount,
      } : null,
      totalUploads: uploadCount?.count || 0,
      latestDataDate: latestDate?.date || null,
      previousDateStats,
      changes: previousDateStats ? {
        shareholdersChange: activeShareholdersCount - previousDateStats.shareholdersCount,
        sharesChange: totalShares - previousDateStats.totalShares,
        shareholdersChangePercent: previousDateStats.shareholdersCount > 0 
          ? ((activeShareholdersCount - previousDateStats.shareholdersCount) / previousDateStats.shareholdersCount * 100).toFixed(2)
          : 0,
        sharesChangePercent: previousDateStats.totalShares > 0
          ? ((totalShares - previousDateStats.totalShares) / previousDateStats.totalShares * 100).toFixed(2)
          : 0,
      } : null,
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard statistics' },
      { status: 500 }
    );
  }
}