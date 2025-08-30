// Test Excel serial number conversion
const testNumbers = [45894, 45891, 45890, 45889, 45884, 45883, 45882];

console.log('Testing Excel serial number conversion:');
console.log('');

testNumbers.forEach(serialNum => {
  const excelDate = new Date((serialNum - 25569) * 86400 * 1000);
  const dateString = excelDate.toISOString().split('T')[0];
  console.log(`Serial ${serialNum} → ${dateString}`);
});

console.log('');
console.log('Expected dates based on sheet names:');
console.log('25agt25 → 2025-08-25');
console.log('22agt25 → 2025-08-22');
console.log('21agt25 → 2025-08-21');