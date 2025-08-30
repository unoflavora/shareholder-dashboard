import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings, uploads, auditLogs } from '@/lib/db/schema';
import { eq, inArray, and, sql, desc } from 'drizzle-orm';
import * as XLSX from 'xlsx';

export async function POST(req: NextRequest) {
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
      { error: 'File is required' },
      { status: 400 }
    );
  }

  // Create a TransformStream for streaming responses
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Function to send progress updates
  const sendProgress = async (data: any) => {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    await writer.write(encoder.encode(message));
  };

  // Process in background
  (async () => {
    try {
      await sendProgress({ type: 'start', message: 'Starting upload process...' });

      // Convert file to buffer
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      await sendProgress({ type: 'parsing', message: 'Parsing Excel file...' });

      // Parse Excel/CSV file
      let data: any[] = [];
      
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        
        // Process all sheets in the workbook
        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          
          // Skip empty sheets or sheets with fewer than 3 rows
          if (rawData.length < 3) {
            await sendProgress({ 
              type: 'info', 
              message: `Skipping sheet "${sheetName}" - insufficient rows (${rawData.length})` 
            });
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
            await sendProgress({ 
              type: 'error', 
              message: `No date found in sheet "${sheetName}" at row 3. Please ensure the date is in column A or B of row 3.` 
            });
            await writer.close();
            return;
          }
          
          await sendProgress({ 
            type: 'info', 
            message: `Processing sheet "${sheetName}" with date: ${sheetDate}` 
          });
          
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
            continue;
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
              obj._sheetName = sheetName;
              obj._accountHolder = obj['Nama Pemegang Rekening'] || '';
              obj._extractedDate = sheetDate; // Store the date for this specific sheet
              data.push(obj);
            }
          }
        }
      }

      if (data.length === 0) {
        await sendProgress({ 
          type: 'error', 
          message: 'No valid data found in file' 
        });
        await writer.close();
        return;
      }

      await sendProgress({ 
        type: 'parsed', 
        message: `Found ${data.length} valid rows`,
        totalRows: data.length 
      });

      // Group data by date
      const dataByDate = new Map<string, any[]>();
      data.forEach(row => {
        const date = row._extractedDate;
        if (!dataByDate.has(date)) {
          dataByDate.set(date, []);
        }
        dataByDate.get(date)!.push(row);
      });

      const uniqueDates = Array.from(dataByDate.keys());
      await sendProgress({ 
        type: 'info', 
        message: `Found ${uniqueDates.length} unique dates: ${uniqueDates.join(', ')}` 
      });
      
      // Create upload record - use today's date for the upload record itself
      await sendProgress({ type: 'database', message: 'Creating upload record...' });
      
      const uploadDateString = new Date().toISOString().split('T')[0];
      await db.insert(uploads).values({
        filename: file.name,
        uploadDate: uploadDateString,
        recordsCount: data.length,
        uploadedBy: parseInt(session.user.id),
        status: 'processing',
      });
      
      // Get the inserted upload record
      const [uploadRecord] = await db
        .select()
        .from(uploads)
        .orderBy(desc(uploads.id))
        .limit(1);

      // Prepare data for batch processing with account holders
      const shareholderData = new Map();
      data.forEach(row => {
        const name = row['Nama'];
        if (name && !shareholderData.has(name)) {
          shareholderData.set(name, {
            name,
            accountHolder: row._accountHolder || null
          });
        }
      });
      const shareholderNames = Array.from(shareholderData.keys());
      
      await sendProgress({ 
        type: 'checking', 
        message: `Checking ${shareholderNames.length} unique shareholders...` 
      });

      // Process in smaller chunks to avoid stack overflow
      const CHUNK_SIZE = 50;
      const existingShareholderMap = new Map();
      
      // Process shareholder names in chunks
      for (let i = 0; i < shareholderNames.length; i += CHUNK_SIZE) {
        const chunk = shareholderNames.slice(i, i + CHUNK_SIZE);
        
        // Get existing shareholders for this chunk
        const existingShareholders = await db
          .select()
          .from(shareholders)
          .where(inArray(shareholders.name, chunk));
        
        // Add to map and update account holders if needed
        existingShareholders.forEach(s => {
          existingShareholderMap.set(s.name, s);
        });
        
        // Update existing shareholders with account holder info if missing
        const shareholdersToUpdate = existingShareholders.filter(s => {
          const newAccountHolder = shareholderData.get(s.name)?.accountHolder;
          return newAccountHolder && (!s.accountHolder || s.accountHolder !== newAccountHolder);
        });
        
        if (shareholdersToUpdate.length > 0) {
          for (const shareholder of shareholdersToUpdate) {
            const newAccountHolder = shareholderData.get(shareholder.name)?.accountHolder;
            if (newAccountHolder) {
              await db
                .update(shareholders)
                .set({ accountHolder: newAccountHolder })
                .where(eq(shareholders.id, shareholder.id));
              
              // Update the map with the new account holder
              existingShareholderMap.set(shareholder.name, {
                ...shareholder,
                accountHolder: newAccountHolder
              });
            }
          }
        }
      }

      // Find new shareholders
      const newShareholderNames = shareholderNames.filter(
        name => !existingShareholderMap.has(name)
      );
      
      if (newShareholderNames.length > 0) {
        await sendProgress({ 
          type: 'inserting_shareholders', 
          message: `Creating ${newShareholderNames.length} new shareholders...`,
          count: newShareholderNames.length 
        });

        // Insert new shareholders in small chunks
        let insertedCount = 0;
        for (let i = 0; i < newShareholderNames.length; i += CHUNK_SIZE) {
          const chunk = newShareholderNames.slice(i, i + CHUNK_SIZE);
          
          const shareholdersToInsert = chunk.map(name => ({
            name,
            shareholderNo: null as number | null,
            accountHolder: shareholderData.get(name)?.accountHolder || null,
          }));

          await db
            .insert(shareholders)
            .values(shareholdersToInsert);
          
          insertedCount += chunk.length;
          
          // Get the inserted shareholders by names to update the map
          const insertedShareholders = await db
            .select()
            .from(shareholders)
            .where(inArray(shareholders.name, chunk));
          
          // Update map
          insertedShareholders.forEach(s => {
            existingShareholderMap.set(s.name, s);
          });

          await sendProgress({ 
            type: 'progress_shareholders', 
            message: `Created ${insertedCount} of ${newShareholderNames.length} shareholders`,
            current: insertedCount,
            total: newShareholderNames.length,
            percentage: Math.round((insertedCount / newShareholderNames.length) * 100)
          });
        }
      }

      // Process each date group separately
      const errors: string[] = [];
      let totalProcessedCount = 0;
      let totalErrorCount = 0;

      for (const [currentDate, dateData] of dataByDate) {
        await sendProgress({ 
          type: 'preparing', 
          message: `Processing ${dateData.length} records for date: ${currentDate}` 
        });

        const shareholdingsToInsert: any[] = [];
        let errorCount = 0;

        for (let i = 0; i < dateData.length; i++) {
          const row = dateData[i];
          const name = row['Nama'];
          
          if (!name) {
            errors.push(`${currentDate} - Row ${i + 1}: Missing shareholder name`);
            errorCount++;
            continue;
          }

          const shareholder = existingShareholderMap.get(name);
          if (!shareholder) {
            errors.push(`${currentDate} - Row ${i + 1}: Shareholder not found`);
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
            date: currentDate, // Use the specific date for this sheet
          });
        }

        // Delete existing shareholdings for this specific date
        if (shareholdingsToInsert.length > 0) {
          await sendProgress({ 
            type: 'cleaning', 
            message: `Removing old data for date: ${currentDate}...` 
          });

          const shareholderIds = shareholdingsToInsert.map(s => s.shareholderId);
          
          // Delete in chunks to avoid query size limits
          for (let i = 0; i < shareholderIds.length; i += CHUNK_SIZE) {
            const chunk = shareholderIds.slice(i, i + CHUNK_SIZE);
            await db
              .delete(shareholdings)
              .where(
                and(
                  inArray(shareholdings.shareholderId, chunk),
                  eq(shareholdings.date, currentDate)
                )
              );
          }
        }

        // Insert shareholdings for this date in smaller chunks
        if (shareholdingsToInsert.length > 0) {
          await sendProgress({ 
            type: 'inserting_holdings', 
            message: `Creating ${shareholdingsToInsert.length} records for date: ${currentDate}...`,
            count: shareholdingsToInsert.length 
          });

          let insertedCount = 0;
          for (let i = 0; i < shareholdingsToInsert.length; i += CHUNK_SIZE) {
            const chunk = shareholdingsToInsert.slice(i, i + CHUNK_SIZE);
            await db.insert(shareholdings).values(chunk);
            
            insertedCount += chunk.length;
            
            await sendProgress({ 
              type: 'progress_holdings', 
              message: `Created ${insertedCount} of ${shareholdingsToInsert.length} records for ${currentDate}`,
              current: insertedCount,
              total: shareholdingsToInsert.length,
              percentage: Math.round((insertedCount / shareholdingsToInsert.length) * 100)
            });
          }
        }

        totalProcessedCount += shareholdingsToInsert.length;
        totalErrorCount += errorCount;
      }

      // Update upload status
      await sendProgress({ type: 'finalizing', message: 'Finalizing upload...' });

      await db
        .update(uploads)
        .set({
          status: totalErrorCount > 0 ? 'completed_with_errors' : 'completed',
        })
        .where(eq(uploads.id, uploadRecord.id));

      // Create audit log
      await db.insert(auditLogs).values({
        userId: parseInt(session.user.id),
        action: 'upload_data_stream',
        entityType: 'upload',
        entityId: uploadRecord.id,
        details: JSON.stringify({
          fileName: file.name,
          recordCount: data.length,
          processedCount: totalProcessedCount,
          errorCount: totalErrorCount,
          uniqueDates: uniqueDates,
          sheetsProcessed: dataByDate.size,
        }),
      });

      // Send completion
      await sendProgress({ 
        type: 'complete', 
        message: `Successfully processed ${totalProcessedCount} records across ${uniqueDates.length} dates`,
        uploadId: uploadRecord.id,
        processedCount: totalProcessedCount,
        errorCount: totalErrorCount,
        errors: errors.slice(0, 10)
      });

    } catch (error: any) {
      console.error('Stream upload error:', error);
      await sendProgress({ 
        type: 'error', 
        message: 'Failed to process upload',
        error: error?.message || 'Unknown error'
      });
    } finally {
      await writer.close();
    }
  })();

  // Return the stream as response
  return new NextResponse(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}