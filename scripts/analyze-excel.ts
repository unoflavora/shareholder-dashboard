import { config } from 'dotenv';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

// Load environment variables
config({ path: '.env.local' });

async function analyzeExcel() {
  try {
    const filePath = '/Users/imamsyahid/Downloads/example.xlsx';
    
    if (!fs.existsSync(filePath)) {
      console.log('❌ File not found:', filePath);
      return;
    }

    console.log('📊 Analyzing Excel file:', filePath);
    console.log('');

    // Read the Excel file
    const buffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    console.log(`📋 Found ${workbook.SheetNames.length} sheets:`);
    console.log('');

    for (const sheetName of workbook.SheetNames) {
      console.log(`📄 Sheet: "${sheetName}"`);
      
      const worksheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      console.log(`   Rows: ${rawData.length}`);
      
      // Show first few rows to understand structure
      console.log('   First 5 rows:');
      for (let i = 0; i < Math.min(5, rawData.length); i++) {
        const row = rawData[i];
        if (row && row.length > 0) {
          const rowPreview = row.slice(0, 5).map(cell => 
            cell === null || cell === undefined || cell === '' ? '[empty]' : String(cell).substring(0, 20)
          ).join(' | ');
          console.log(`     Row ${i + 1}: ${rowPreview}`);
        }
      }
      
      // Check row 3 specifically for date
      if (rawData.length > 2 && rawData[2]) {
        const row3 = rawData[2];
        console.log(`   📅 Row 3 (date check):`, row3.slice(0, 3));
        
        if (row3[0]) {
          const dateCell = row3[0];
          console.log(`      First cell: "${dateCell}" (type: ${typeof dateCell})`);
          
          if (dateCell instanceof Date) {
            const extractedDate = dateCell.toISOString().split('T')[0];
            console.log(`      ✅ Date object found: ${extractedDate}`);
          } else if (typeof dateCell === 'string' || typeof dateCell === 'number') {
            const dateStr = String(dateCell);
            const dateMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})|(\d{2}\/\d{2}\/\d{4})|(\d{4}\/\d{2}\/\d{2})/);
            if (dateMatch) {
              const dateValue = new Date(dateMatch[0]);
              if (!isNaN(dateValue.getTime())) {
                const extractedDate = dateValue.toISOString().split('T')[0];
                console.log(`      ✅ Date pattern found: ${extractedDate}`);
              } else {
                console.log(`      ❌ Date pattern found but invalid: ${dateMatch[0]}`);
              }
            } else {
              console.log(`      ❌ No date pattern found in: "${dateStr}"`);
            }
          }
        } else {
          console.log(`      ❌ Row 3 first cell is empty`);
        }
      } else {
        console.log(`   ❌ Sheet has fewer than 3 rows`);
      }
      
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error analyzing Excel:', error);
  }
}

// Run the analysis
analyzeExcel()
  .then(() => {
    console.log('✨ Analysis completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Analysis failed:', error);
    process.exit(1);
  });