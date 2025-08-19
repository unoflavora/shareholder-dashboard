import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings } from '@/lib/db/schema';
import { eq, and, like, sql } from 'drizzle-orm';

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
    const search = searchParams.get('search') || '';
    const date = searchParams.get('date') || '';

    // Build query
    let query = db
      .select({
        name: shareholders.name,
        shares: shareholdings.sharesAmount,
        percentage: shareholdings.percentage,
        date: shareholdings.date,
      })
      .from(shareholders)
      .leftJoin(
        shareholdings,
        and(
          eq(shareholdings.shareholderId, shareholders.id),
          date ? eq(shareholdings.date, new Date(date)) : sql`1=1`
        )
      );

    // Apply search filter
    if (search) {
      query = query.where(like(shareholders.name, `%${search}%`));
    }

    const results = await query;

    // Convert to CSV
    const csvHeaders = ['Name', 'Shares', 'Percentage', 'Date'];
    const csvRows = results.map(row => [
      row.name,
      row.shares || '',
      row.percentage || '',
      row.date ? new Date(row.date).toLocaleDateString() : '',
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    // Return CSV file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="shareholders_${date || 'export'}.csv"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    );
  }
}