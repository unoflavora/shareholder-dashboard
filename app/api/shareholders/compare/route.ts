import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings } from '@/lib/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';

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
    const date1 = searchParams.get('date1');
    const date2 = searchParams.get('date2');

    if (!date1 || !date2) {
      return NextResponse.json(
        { error: 'Both dates are required' },
        { status: 400 }
      );
    }

    const date1Obj = new Date(date1);
    const date2Obj = new Date(date2);

    // Get shareholdings for both dates
    const [holdings1, holdings2] = await Promise.all([
      db
        .select({
          shareholderId: shareholdings.shareholderId,
          name: shareholders.name,
          shares: shareholdings.shares,
          percentage: shareholdings.percentage,
        })
        .from(shareholdings)
        .innerJoin(shareholders, eq(shareholdings.shareholderId, shareholders.id))
        .where(eq(shareholdings.date, date1Obj)),
      
      db
        .select({
          shareholderId: shareholdings.shareholderId,
          name: shareholders.name,
          shares: shareholdings.shares,
          percentage: shareholdings.percentage,
        })
        .from(shareholdings)
        .innerJoin(shareholders, eq(shareholdings.shareholderId, shareholders.id))
        .where(eq(shareholdings.date, date2Obj)),
    ]);

    // Create maps for easier comparison
    const map1 = new Map(holdings1.map(h => [h.shareholderId, h]));
    const map2 = new Map(holdings2.map(h => [h.shareholderId, h]));

    // Categorize shareholders
    const newShareholders: any[] = [];
    const removedShareholders: any[] = [];
    const changedShareholders: any[] = [];
    const unchangedShareholders: any[] = [];

    // Check for removed and changed shareholders
    for (const [id, holder1] of map1) {
      const holder2 = map2.get(id);
      
      if (!holder2) {
        removedShareholders.push({
          ...holder1,
          status: 'removed',
        });
      } else {
        const sharesChange = (holder2.shares || 0) - (holder1.shares || 0);
        const percentageChange = (holder2.percentage || 0) - (holder1.percentage || 0);
        
        if (sharesChange !== 0 || percentageChange !== 0) {
          changedShareholders.push({
            ...holder2,
            previousShares: holder1.shares,
            previousPercentage: holder1.percentage,
            sharesChange,
            percentageChange,
            status: 'changed',
          });
        } else {
          unchangedShareholders.push({
            ...holder2,
            status: 'unchanged',
          });
        }
      }
    }

    // Check for new shareholders
    for (const [id, holder2] of map2) {
      if (!map1.has(id)) {
        newShareholders.push({
          ...holder2,
          status: 'new',
        });
      }
    }

    // Calculate summary statistics
    const totalShares1 = holdings1.reduce((sum, h) => sum + (h.shares || 0), 0);
    const totalShares2 = holdings2.reduce((sum, h) => sum + (h.shares || 0), 0);

    return NextResponse.json({
      date1: {
        date: date1,
        totalShareholders: holdings1.length,
        totalShares: totalShares1,
      },
      date2: {
        date: date2,
        totalShareholders: holdings2.length,
        totalShares: totalShares2,
      },
      comparison: {
        shareholdersChange: holdings2.length - holdings1.length,
        sharesChange: totalShares2 - totalShares1,
        newCount: newShareholders.length,
        removedCount: removedShareholders.length,
        changedCount: changedShareholders.length,
        unchangedCount: unchangedShareholders.length,
      },
      details: {
        new: newShareholders,
        removed: removedShareholders,
        changed: changedShareholders,
        unchanged: unchangedShareholders,
      },
    });
  } catch (error) {
    console.error('Error comparing dates:', error);
    return NextResponse.json(
      { error: 'Failed to compare dates' },
      { status: 500 }
    );
  }
}