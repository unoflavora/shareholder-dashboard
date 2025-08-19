import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings, uploads, auditLogs } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
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

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!uploadDate) {
      return NextResponse.json(
        { error: 'Upload date is required' },
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
      
      // Get raw data as array of arrays to handle header rows properly
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      // Find the header row (contains "No", "Nama", etc.)
      let headerRowIndex = -1;
      for (let i = 0; i < Math.min(10, rawData.length); i++) {
        const row = rawData[i];
        if (row && row.some(cell => 
          cell && (String(cell).toLowerCase().includes('nama') || 
                   String(cell).toLowerCase().includes('name'))
        )) {
          headerRowIndex = i;
          break;
        }
      }
      
      if (headerRowIndex === -1) {
        return NextResponse.json(
          { error: 'Could not find header row with column names' },
          { status: 400 }
        );
      }
      
      // Get headers and normalize them
      const headers = rawData[headerRowIndex].map(h => String(h || '').trim());
      
      console.log('Found headers at row', headerRowIndex + 1, ':', headers);
      
      // Parse data starting from the row after headers
      for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;
        
        // Skip rows where the first column (No) is not a number
        if (row[0] === null || row[0] === undefined || row[0] === '') continue;
        
        const obj: any = {};
        headers.forEach((header, index) => {
          if (row[index] !== undefined && row[index] !== null && row[index] !== '') {
            obj[header] = row[index];
          }
        });
        
        // Only add rows that have actual data (not just the No column)
        if (Object.keys(obj).length > 1 && obj['Nama']) {
          data.push(obj);
        }
      }
      
      console.log('Parsed', data.length, 'data rows from Excel');
    } else if (file.name.endsWith('.csv')) {
      const text = buffer.toString('utf-8');
      const workbook = XLSX.read(text, { type: 'string' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet);
    } else {
      return NextResponse.json(
        { error: 'Invalid file format. Please upload Excel (.xlsx, .xls) or CSV file.' },
        { status: 400 }
      );
    }

    if (data.length === 0) {
      return NextResponse.json(
        { error: 'No valid data rows found in file. Please check the file format.' },
        { status: 400 }
      );
    }

    // Log first few rows to debug
    console.log('Sample data (first 3 rows):', data.slice(0, 3));
    console.log('Total valid data rows:', data.length);
    
    // Log column names from first row with data
    if (data.length > 0) {
      console.log('Column names in data:', Object.keys(data[0]));
    }

    // Start transaction
    const uploadDateObj = new Date(uploadDate);
    
    // Create upload record
    const dateString = uploadDateObj.toISOString().split('T')[0];
    const [uploadRecord] = await db.insert(uploads).values({
      filename: file.name,
      uploadDate: dateString,
      recordsCount: data.length,
      uploadedBy: parseInt(session.user.id),
      status: 'processing',
    }).returning();

    let processedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    console.log(`Starting to process ${data.length} rows...`);

    // Process each row
    for (let i = 0; i < data.length; i++) {
      // Log progress every 100 rows
      if (i > 0 && i % 100 === 0) {
        console.log(`Processed ${i} of ${data.length} rows...`);
      }
      const row = data[i];
      const rowNumber = i + 1;
      
      try {
        // Extract fields - handle different possible column names
        const name = row['Nama'] || row['Name'] || row['name'] || '';
        const sharesRaw = row['Jumlah Saham'] || row['Jumlah_Saham'] || row['Shares'] || row['shares'] || '0';
        const percentageRaw = row['%'] || row['Percentage'] || row['percentage'] || '0';
        
        const shares = parseInt(String(sharesRaw).replace(/,/g, '')) || 0;
        const percentage = parseFloat(String(percentageRaw)) || 0;

        if (!name || String(name).trim() === '') {
          if (i < 10) { // Only log first 10 to avoid spam
            console.log(`Row ${rowNumber} skipped - no name. Row data:`, row);
          }
          errors.push(`Row ${rowNumber}: Missing shareholder name`);
          errorCount++;
          continue;
        }

        // Check if shareholder exists
        let [shareholder] = await db
          .select()
          .from(shareholders)
          .where(eq(shareholders.name, name))
          .limit(1);

        // If not exists, create new shareholder
        if (!shareholder) {
          [shareholder] = await db
            .insert(shareholders)
            .values({
              name,
              shareholderNo: row['No'] ? parseInt(String(row['No'])) : null,
            })
            .returning();
        } else {
          // Update the updatedAt timestamp
          await db
            .update(shareholders)
            .set({ 
              updatedAt: uploadDateObj,
              shareholderNo: row['No'] ? parseInt(String(row['No'])) : shareholder.shareholderNo,
            })
            .where(eq(shareholders.id, shareholder.id));
        }

        // Check if shareholding exists for this date
        const existingHolding = await db
          .select()
          .from(shareholdings)
          .where(
            and(
              eq(shareholdings.shareholderId, shareholder.id),
              eq(shareholdings.date, dateString)
            )
          )
          .limit(1);

        if (existingHolding.length > 0) {
          // Update existing holding
          await db
            .update(shareholdings)
            .set({
              sharesAmount: shares,
              percentage,
            })
            .where(eq(shareholdings.id, existingHolding[0].id));
        } else {
          // Create new shareholding
          await db
            .insert(shareholdings)
            .values({
              shareholderId: shareholder.id,
              sharesAmount: shares,
              percentage,
              date: dateString,
            });
        }

        processedCount++;
      } catch (error: any) {
        console.error('Error processing row:', error);
        let errorMessage = 'Unknown error';
        
        if (error?.cause?.message) {
          errorMessage = error.cause.message;
        } else if (error?.message) {
          errorMessage = error.message;
        }
        
        errors.push(`Row ${rowNumber}: ${errorMessage}`);
        errorCount++;
        
        // If it's a database schema error, stop processing and return immediately
        if (errorMessage.includes('SQLITE_CONSTRAINT') || errorMessage.includes('NOT NULL')) {
          return NextResponse.json(
            { 
              error: 'Database schema error', 
              details: errorMessage,
              suggestion: 'Please check the database schema and column names'
            },
            { status: 500 }
          );
        }
      }
    }

    console.log(`Processing complete. Processed: ${processedCount}, Errors: ${errorCount}`);

    // Update upload status
    await db
      .update(uploads)
      .set({
        status: errorCount > 0 ? 'completed_with_errors' : 'completed',
      })
      .where(eq(uploads.id, uploadRecord.id));

    console.log('Upload status updated');

    // Create audit log
    await db.insert(auditLogs).values({
      userId: parseInt(session.user.id),
      action: 'upload_data',
      entityType: 'upload',
      entityId: uploadRecord.id,
      details: JSON.stringify({
        fileName: file.name,
        recordCount: data.length,
        processedCount,
        errorCount,
        uploadDate: uploadDate,
      }),
    });

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${processedCount} records`,
      uploadId: uploadRecord.id,
      processedCount,
      errorCount,
      errors: errors.slice(0, 10), // Return first 10 errors
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    
    let errorMessage = 'Failed to process upload';
    let errorDetails = '';
    
    if (error?.cause?.message) {
      errorDetails = error.cause.message;
    } else if (error?.message) {
      errorDetails = error.message;
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        details: errorDetails,
        suggestion: errorDetails.includes('SQLITE_CONSTRAINT') || errorDetails.includes('NOT NULL')
          ? 'Database schema mismatch - please check column names'
          : 'Please check the file format and try again'
      },
      { status: 500 }
    );
  }
}