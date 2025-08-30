import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings } from '@/lib/db/schema';
import { eq, and, like, desc, asc, sql } from 'drizzle-orm';

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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const date = searchParams.get('date') || '';
    const sortBy = searchParams.get('sortBy') || 'name';
    const sortOrder = searchParams.get('sortOrder') || 'asc';

    const offset = (page - 1) * limit;

    // Build query
    let query = db
      .select({
        id: shareholders.id,
        name: shareholders.name,
        accountHolder: shareholders.accountHolder,
        shares: shareholdings.sharesAmount,
        percentage: shareholdings.percentage,
        date: shareholdings.date,
        createdAt: shareholders.createdAt,
        updatedAt: shareholders.updatedAt,
      })
      .from(shareholders)
      .leftJoin(
        shareholdings,
        and(
          eq(shareholdings.shareholderId, shareholders.id),
          date ? eq(shareholdings.date, date) : sql`1=1`
        )
      );

    // Apply search filter
    if (search) {
      query = query.where(like(shareholders.name, `%${search}%`));
    }

    // Get total count - count based on the actual query structure
    let countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(shareholders)
      .leftJoin(
        shareholdings,
        and(
          eq(shareholdings.shareholderId, shareholders.id),
          date ? eq(shareholdings.date, date) : sql`1=1`
        )
      );
    
    if (search) {
      countQuery = countQuery.where(like(shareholders.name, `%${search}%`));
    }
    
    const countResult = await countQuery;
    const totalCount = countResult[0].count;

    // Apply sorting with stable secondary sort
    if (sortBy === 'name') {
      query = sortOrder === 'asc' 
        ? query.orderBy(asc(shareholders.name), desc(shareholdings.date), asc(shareholders.id))
        : query.orderBy(desc(shareholders.name), desc(shareholdings.date), asc(shareholders.id));
    } else if (sortBy === 'shares') {
      query = sortOrder === 'asc'
        ? query.orderBy(asc(shareholdings.sharesAmount), asc(shareholders.name), desc(shareholdings.date), asc(shareholders.id))
        : query.orderBy(desc(shareholdings.sharesAmount), asc(shareholders.name), desc(shareholdings.date), asc(shareholders.id));
    } else if (sortBy === 'percentage') {
      query = sortOrder === 'asc'
        ? query.orderBy(asc(shareholdings.percentage), asc(shareholders.name), desc(shareholdings.date), asc(shareholders.id))
        : query.orderBy(desc(shareholdings.percentage), asc(shareholders.name), desc(shareholdings.date), asc(shareholders.id));
    }

    // Apply pagination
    query = query.limit(limit).offset(offset);

    const results = await query;

    // Convert percentage strings to numbers for frontend compatibility
    const processedResults = results.map(shareholder => ({
      ...shareholder,
      percentage: shareholder.percentage ? parseFloat(shareholder.percentage as string) : null,
    }));

    return NextResponse.json({
      shareholders: processedResults,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching shareholders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shareholders' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { name, shares, percentage, date } = await req.json();

    if (!name || !date) {
      return NextResponse.json(
        { error: 'Name and date are required' },
        { status: 400 }
      );
    }

    // Check if shareholder exists
    let [shareholder] = await db
      .select()
      .from(shareholders)
      .where(eq(shareholders.name, name))
      .limit(1);

    const shareholderDate = new Date(date);

    // If not exists, create new shareholder
    if (!shareholder) {
      await db
        .insert(shareholders)
        .values({
          name,
        });
      // Get the newly created shareholder
      [shareholder] = await db
        .select()
        .from(shareholders)
        .where(eq(shareholders.name, name))
        .limit(1);
    }

    // Create or update shareholding
    const existingHolding = await db
      .select()
      .from(shareholdings)
      .where(
        and(
          eq(shareholdings.shareholderId, shareholder.id),
          eq(shareholdings.date, date)
        )
      )
      .limit(1);

    if (existingHolding.length > 0) {
      // Update existing holding
      await db
        .update(shareholdings)
        .set({
          sharesAmount: shares || 0,
          percentage: percentage || 0,
        })
        .where(eq(shareholdings.id, existingHolding[0].id));
    } else {
      // Create new shareholding
      await db
        .insert(shareholdings)
        .values({
          shareholderId: shareholder.id,
          sharesAmount: shares || 0,
          percentage: percentage || 0,
          date: date,
        });
    }

    return NextResponse.json({
      success: true,
      message: 'Shareholder data saved successfully',
      shareholderId: shareholder.id,
    });
  } catch (error) {
    console.error('Error creating shareholder:', error);
    return NextResponse.json(
      { error: 'Failed to create shareholder' },
      { status: 500 }
    );
  }
}