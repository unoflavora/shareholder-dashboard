import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholders, shareholdings, uploads, auditLogs } from '@/lib/db/schema';
import { eq, inArray, and } from 'drizzle-orm';
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
  const uploadDate = formData.get('date') as string;

  if (!file || !uploadDate) {
    return NextResponse.json(
      { error: 'File and date are required' },
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
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
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
          await sendProgress({ 
            type: 'error', 
            message: 'Could not find header row in file' 
          });
          await writer.close();
          return;
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

      const dateString = new Date(uploadDate).toISOString().split('T')[0];
      
      // Create upload record
      await sendProgress({ type: 'database', message: 'Creating upload record...' });
      
      const [uploadRecord] = await db.insert(uploads).values({
        filename: file.name,
        uploadDate: dateString,
        recordsCount: data.length,
        uploadedBy: parseInt(session.user.id),
        status: 'processing',
      }).returning();

      // Prepare data for batch processing
      const shareholderNames = [...new Set(data.map(row => row['Nama']))].filter(Boolean);
      
      await sendProgress({ 
        type: 'checking', 
        message: `Checking ${shareholderNames.length} unique shareholders...` 
      });

      // Get existing shareholders
      const existingShareholders = await db
        .select()
        .from(shareholders)
        .where(inArray(shareholders.name, shareholderNames));
      
      const existingShareholderMap = new Map(
        existingShareholders.map(s => [s.name, s])
      );

      // Prepare new shareholders
      const newShareholderNames = shareholderNames.filter(
        name => !existingShareholderMap.has(name)
      );
      
      if (newShareholderNames.length > 0) {
        await sendProgress({ 
          type: 'inserting_shareholders', 
          message: `Creating ${newShareholderNames.length} new shareholders...`,
          count: newShareholderNames.length 
        });

        const shareholdersToInsert = newShareholderNames.map(name => ({
          name,
          shareholderNo: null as number | null,
        }));

        // Insert in chunks of 100
        let insertedCount = 0;
        for (let i = 0; i < shareholdersToInsert.length; i += 100) {
          const chunk = shareholdersToInsert.slice(i, i + 100);
          const inserted = await db
            .insert(shareholders)
            .values(chunk)
            .returning();
          
          insertedCount += inserted.length;
          
          // Update map
          inserted.forEach(s => {
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

      // Prepare shareholdings data
      await sendProgress({ 
        type: 'preparing', 
        message: 'Preparing shareholding records...' 
      });

      const shareholdingsToInsert: any[] = [];
      const errors: string[] = [];
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
          errors.push(`Row ${i + 1}: Shareholder not found`);
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
      }

      // Delete existing shareholdings for this date
      if (shareholdingsToInsert.length > 0) {
        await sendProgress({ 
          type: 'cleaning', 
          message: 'Removing old data for this date...' 
        });

        const shareholderIds = shareholdingsToInsert.map(s => s.shareholderId);
        await db
          .delete(shareholdings)
          .where(
            and(
              inArray(shareholdings.shareholderId, shareholderIds),
              eq(shareholdings.date, dateString)
            )
          );
      }

      // Insert shareholdings in chunks
      if (shareholdingsToInsert.length > 0) {
        await sendProgress({ 
          type: 'inserting_holdings', 
          message: `Creating ${shareholdingsToInsert.length} shareholding records...`,
          count: shareholdingsToInsert.length 
        });

        let insertedCount = 0;
        for (let i = 0; i < shareholdingsToInsert.length; i += 100) {
          const chunk = shareholdingsToInsert.slice(i, i + 100);
          await db.insert(shareholdings).values(chunk);
          
          insertedCount += chunk.length;
          
          await sendProgress({ 
            type: 'progress_holdings', 
            message: `Created ${insertedCount} of ${shareholdingsToInsert.length} shareholding records`,
            current: insertedCount,
            total: shareholdingsToInsert.length,
            percentage: Math.round((insertedCount / shareholdingsToInsert.length) * 100)
          });
        }
      }

      // Update upload status
      await sendProgress({ type: 'finalizing', message: 'Finalizing upload...' });

      await db
        .update(uploads)
        .set({
          status: errorCount > 0 ? 'completed_with_errors' : 'completed',
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
          processedCount: shareholdingsToInsert.length,
          errorCount,
          uploadDate: dateString,
        }),
      });

      // Send completion
      await sendProgress({ 
        type: 'complete', 
        message: `Successfully processed ${shareholdingsToInsert.length} records`,
        uploadId: uploadRecord.id,
        processedCount: shareholdingsToInsert.length,
        errorCount,
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