import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings, uploads, auditLogs } from '@/lib/db/schema';
import { eq, inArray, and, desc } from 'drizzle-orm';
import * as XLSX from 'xlsx';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const uploadDate = formData.get('date') as string;

    if (!file || !uploadDate) {
      return NextResponse.json(
        { error: 'File and date are required' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Parse Excel/CSV file
    let data: any[] = [];
    
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Get raw data as array of arrays
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      // Find header row
      let headerRowIndex = -1;
      for (let i = 0; i < Math.min(10, rawData.length); i++) {
        const row = rawData[i];
        if (row && row.some(cell => 
          cell && String(cell).toLowerCase().includes('nama')
        )) {
          headerRowIndex = i;
          break;
        }
      }
      
      if (headerRowIndex === -1) {
        return NextResponse.json(
          { error: 'Could not find header row' },
          { status: 400 }
        );
      }
      
      const headers = rawData[headerRowIndex].map(h => String(h || '').trim());
      
      // Parse data rows
      for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0 || !row[0]) continue;
        
        const obj: any = {};
        headers.forEach((header, index) => {
          if (row[index] !== undefined && row[index] !== null && row[index] !== '') {
            obj[header] = row[index];
          }
        });
        
        if (Object.keys(obj).length > 1 && obj['Nama']) {
          data.push(obj);
        }
      }
    } else {
      return NextResponse.json(
        { error: 'Invalid file format' },
        { status: 400 }
      );
    }

    if (data.length === 0) {
      return NextResponse.json(
        { error: 'No valid data found' },
        { status: 400 }
      );
    }

    console.log(`Processing ${data.length} rows in batch mode...`);

    const dateString = new Date(uploadDate).toISOString().split('T')[0];
    
    // Create upload record
    await db.insert(uploads).values({
      filename: file.name,
      uploadDate: dateString,
      recordsCount: data.length,
      uploadedBy: parseInt(session.user.id),
      status: 'processing',
    });
    
    // Get the uploaded record
    const [uploadRecord] = await db
      .select()
      .from(uploads)
      .orderBy(desc(uploads.id))
      .limit(1);

    // Prepare data for batch processing
    const shareholderNames = [...new Set(data.map(row => row['Nama']))].filter(Boolean);
    
    // Get existing shareholders in batch
    const existingShareholders = await db
      .select()
      .from(shareholders)
      .where(inArray(shareholders.name, shareholderNames));
    
    const existingShareholderMap = new Map(
      existingShareholders.map(s => [s.name, s])
    );

    // Prepare new shareholders to insert
    const newShareholderNames = shareholderNames.filter(
      name => !existingShareholderMap.has(name)
    );
    
    const shareholdersToInsert = newShareholderNames.map(name => ({
      name,
      shareholderNo: null as number | null,
    }));

    // Batch insert new shareholders
    let insertedShareholders: any[] = [];
    if (shareholdersToInsert.length > 0) {
      // Insert in chunks of 100 to avoid query size limits
      for (let i = 0; i < shareholdersToInsert.length; i += 100) {
        const chunk = shareholdersToInsert.slice(i, i + 100);
        await db
          .insert(shareholders)
          .values(chunk);
        
        // Get the inserted shareholders by names
        const chunkNames = chunk.map(s => s.name);
        const inserted = await db
          .select()
          .from(shareholders)
          .where(inArray(shareholders.name, chunkNames));
        insertedShareholders.push(...inserted);
      }
      
      console.log(`Inserted ${insertedShareholders.length} new shareholders`);
    }

    // Update the map with newly inserted shareholders
    insertedShareholders.forEach(s => {
      existingShareholderMap.set(s.name, s);
    });

    // Prepare shareholdings data
    const shareholdingsToInsert: any[] = [];
    const errors: string[] = [];
    let processedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const name = row['Nama'];
      
      if (!name) {
        errors.push(`Row ${i + 1}: Missing shareholder name`);
        errorCount++;
        continue;
      }

      const shareholder = existingShareholderMap.get(name);
      if (!shareholder) {
        errors.push(`Row ${i + 1}: Shareholder not found after batch insert`);
        errorCount++;
        continue;
      }

      const sharesRaw = row['Jumlah Saham'] || '0';
      const percentageRaw = row['%'] || '0';
      const shares = parseInt(String(sharesRaw).replace(/,/g, '')) || 0;
      const percentage = parseFloat(String(percentageRaw)) || 0;

      shareholdingsToInsert.push({
        shareholderId: shareholder.id,
        sharesAmount: shares,
        percentage,
        date: dateString,
      });
      
      processedCount++;
    }

    // Delete existing shareholdings for this date (to handle updates)
    const shareholderIds = shareholdingsToInsert.map(s => s.shareholderId);
    if (shareholderIds.length > 0) {
      await db
        .delete(shareholdings)
        .where(
          and(
            inArray(shareholdings.shareholderId, shareholderIds),
            eq(shareholdings.date, dateString)
          )
        );
    }

    // Batch insert shareholdings
    if (shareholdingsToInsert.length > 0) {
      // Insert in chunks of 100
      for (let i = 0; i < shareholdingsToInsert.length; i += 100) {
        const chunk = shareholdingsToInsert.slice(i, i + 100);
        await db.insert(shareholdings).values(chunk);
        
        if (i % 500 === 0) {
          console.log(`Inserted ${Math.min(i + 100, shareholdingsToInsert.length)} of ${shareholdingsToInsert.length} shareholdings`);
        }
      }
      console.log(`Inserted ${shareholdingsToInsert.length} shareholdings`);
    }

    // Update upload status
    await db
      .update(uploads)
      .set({
        status: errorCount > 0 ? 'completed_with_errors' : 'completed',
      })
      .where(eq(uploads.id, uploadRecord.id));

    // Create audit log
    await db.insert(auditLogs).values({
      userId: parseInt(session.user.id),
      action: 'upload_data_batch',
      entityType: 'upload',
      entityId: uploadRecord.id,
      details: JSON.stringify({
        fileName: file.name,
        recordCount: data.length,
        processedCount,
        errorCount,
        uploadDate: dateString,
      }),
    });

    console.log(`Batch processing complete. Processed: ${processedCount}, Errors: ${errorCount}`);

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${processedCount} records`,
      uploadId: uploadRecord.id,
      processedCount,
      errorCount,
      errors: errors.slice(0, 10),
    });
  } catch (error: any) {
    console.error('Batch upload error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to process upload',
        details: error?.message || 'Unknown error'
      },
      { status: 500 }
    );
  }
}