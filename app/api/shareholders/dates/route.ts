import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholdings } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get distinct dates from shareholdings
    const dates = await db
      .selectDistinct({ date: shareholdings.date })
      .from(shareholdings)
      .orderBy(sql`${shareholdings.date} DESC`);

    const formattedDates = dates
      .filter(d => d.date !== null)
      .map(d => d.date!);

    return NextResponse.json({ dates: formattedDates });
  } catch (error) {
    console.error('Error fetching dates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dates' },
      { status: 500 }
    );
  }
}