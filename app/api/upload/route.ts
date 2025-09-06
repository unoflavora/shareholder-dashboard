import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings, uploads, auditLogs } from '@/lib/db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
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

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
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
      
      // Process all sheets in the workbook
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        
        // Get raw data as array of arrays to handle header rows properly
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        // Skip empty sheets or sheets with fewer than 3 rows
        if (rawData.length < 3) {
          console.log(`Skipping sheet "${sheetName}" - insufficient rows (${rawData.length})`);
          continue;
        }
        
        // Extract date from row 3 for this specific sheet
        let sheetDate: string | null = null;
        if (rawData[2]) {
          // Check column A first (index 0), then column B (index 1) for date
          const possibleDateCells = [rawData[2][0], rawData[2][1]].filter(cell => cell != null && cell !== '');
          
          for (const dateCell of possibleDateCells) {
            if (dateCell instanceof Date) {
              sheetDate = dateCell.toISOString().split('T')[0];
              break;
            } else if (typeof dateCell === 'number') {
              // Handle Excel serial date numbers (days since January 1, 1900)
              if (dateCell > 25569 && dateCell < 50000) { // reasonable range for 1970-2036
                const excelDate = new Date((dateCell - 25569) * 86400 * 1000);
                if (!isNaN(excelDate.getTime())) {
                  sheetDate = excelDate.toISOString().split('T')[0];
                  break;
                }
              }
            } else if (typeof dateCell === 'string') {
              const dateStr = String(dateCell);
              const dateMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})|(\d{2}\/\d{2}\/\d{4})|(\d{4}\/\d{2}\/\d{2})/);
              if (dateMatch) {
                const dateValue = new Date(dateMatch[0]);
                if (!isNaN(dateValue.getTime())) {
                  sheetDate = dateValue.toISOString().split('T')[0];
                  break;
                }
              }
            }
          }
        }
        
        // Error if no date found in this sheet
        if (!sheetDate) {
          return NextResponse.json(
            { 
              error: `No date found in sheet "${sheetName}" at row 3`,
              details: `Please ensure the date is in column A or B of row 3. Found values: ${JSON.stringify(rawData[2]?.slice(0, 3) || [])}`
            },
            { status: 400 }
          );
        }
        
        console.log(`Processing sheet "${sheetName}" with date: ${sheetDate}`);
        
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
          console.log(`No header row found in sheet: ${sheetName}`);
          continue;
        }
        
        // Get headers and normalize them
        const headers = rawData[headerRowIndex].map(h => String(h || '').trim());
        
        console.log(`Found headers in sheet ${sheetName} at row`, headerRowIndex + 1, ':', headers);
        
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
          
          // Add sheet information and additional columns
          if (Object.keys(obj).length > 1 && obj['Nama']) {
            obj._sheetName = sheetName;
            obj._accountHolder = obj['Nama Pemegang Rekening'] || '';
            obj._extractedDate = sheetDate; // Store the date for this specific sheet
            data.push(obj);
          }
        }
      }
      
      console.log('Parsed', data.length, 'data rows from', workbook.SheetNames.length, 'sheets');
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

    // Use extracted date if available, otherwise use today's date
    const finalUploadDate = extractedDate || new Date().toISOString().split('T')[0];
    const uploadDateObj = new Date(finalUploadDate);
    
    console.log('Using upload date:', finalUploadDate, extractedDate ? '(extracted from Excel)' : '(using today\'s date)');
    
    // Create upload record
    const dateString = uploadDateObj.toISOString().split('T')[0];
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
        const accountHolder = row['Nama Pemegang Rekening'] || row._accountHolder || '';
        const sharesRaw = row['Jumlah Saham'] || row['Jumlah_Saham'] || row['Shares'] || row['shares'] || '0';
        const percentageRaw = row['%'] || row['Percentage'] || row['percentage'] || '0';
        const sheetName = row._sheetName || 'Sheet1';
        
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
          await db
            .insert(shareholders)
            .values({
              name,
              shareholderNo: row['No'] ? parseInt(String(row['No'])) : null,
              accountHolder,
              sheetName,
            });
          // Get the newly created shareholder
          [shareholder] = await db
            .select()
            .from(shareholders)
            .where(eq(shareholders.name, name))
            .limit(1);
        } else {
          // Update the updatedAt timestamp and additional fields
          await db
            .update(shareholders)
            .set({ 
              updatedAt: uploadDateObj,
              shareholderNo: row['No'] ? parseInt(String(row['No'])) : shareholder.shareholderNo,
              accountHolder: accountHolder || shareholder.accountHolder,
              sheetName: sheetName || shareholder.sheetName,
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
          // Update existing holding with unique timestamp
          const baseTimestamp = new Date();
          const uniqueTimestamp = new Date(baseTimestamp.getTime() + (i * 1000)); // Add milliseconds per row
          
          await db
            .update(shareholdings)
            .set({
              sharesAmount: shares,
              percentage,
              createdAt: uniqueTimestamp,
            })
            .where(eq(shareholdings.id, existingHolding[0].id));
        } else {
          // Create new shareholding with unique timestamp
          const baseTimestamp = new Date();
          // Add microseconds based on row index to ensure unique timestamps
          const uniqueTimestamp = new Date(baseTimestamp.getTime() + (i * 1000)); // Add milliseconds per row
          
          await db
            .insert(shareholdings)
            .values({
              shareholderId: shareholder.id,
              sharesAmount: shares,
              percentage,
              date: dateString,
              createdAt: uniqueTimestamp,
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
        uploadDate: finalUploadDate,
        dateExtracted: !!extractedDate,
        sheetsProcessed: file.name.endsWith('.xlsx') || file.name.endsWith('.xls') ? 'multiple' : 1,
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