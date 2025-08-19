import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { uploads, users } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get upload history with user information
    const uploadHistory = await db
      .select({
        id: uploads.id,
        filename: uploads.filename,
        uploadDate: uploads.uploadDate,
        recordsCount: uploads.recordsCount,
        status: uploads.status,
        createdAt: uploads.createdAt,
        uploadedBy: uploads.uploadedBy,
        userName: users.name,
        userEmail: users.email,
      })
      .from(uploads)
      .leftJoin(users, eq(uploads.uploadedBy, users.id))
      .orderBy(desc(uploads.createdAt));

    return NextResponse.json({
      uploads: uploadHistory.map(upload => ({
        id: upload.id,
        filename: upload.filename,
        uploadDate: upload.uploadDate,
        recordsCount: upload.recordsCount,
        status: upload.status,
        createdAt: upload.createdAt,
        uploadedBy: {
          id: upload.uploadedBy,
          name: upload.userName,
          email: upload.userEmail,
        },
      })),
    });
  } catch (error) {
    console.error('Error fetching upload history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch upload history' },
      { status: 500 }
    );
  }
}