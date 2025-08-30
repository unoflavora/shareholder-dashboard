import { config } from 'dotenv';

async function resetDatabase() {
  try {
    // Load environment variables from .env.local FIRST
    config({ path: '.env.local' });
    
    console.log('🗑️  Starting database reset...');
    console.log('⚠️  This will delete all data except users!');
    console.log('');
    
    // Dynamic imports after environment is loaded
    const { db } = await import('../lib/db/client');
    const { shareholders, shareholdings, uploads, auditLogs } = await import('../lib/db/schema');
    
    // Delete all audit logs
    console.log('Deleting audit logs...');
    await db.delete(auditLogs);
    console.log('✅ Audit logs cleared');

    // Delete all shareholdings
    console.log('Deleting shareholdings...');
    await db.delete(shareholdings);
    console.log('✅ Shareholdings cleared');

    // Delete all shareholders
    console.log('Deleting shareholders...');
    await db.delete(shareholders);
    console.log('✅ Shareholders cleared');

    // Delete all uploads
    console.log('Deleting uploads...');
    await db.delete(uploads);
    console.log('✅ Uploads cleared');

    console.log('');
    console.log('🎉 Database reset completed successfully!');
    console.log('👥 User accounts have been preserved');
    console.log('');
    
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

// Run the script
resetDatabase()
  .then(() => {
    console.log('✨ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });