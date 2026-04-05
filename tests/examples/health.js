/**
 * Health Check Test
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { FeishuClient } from '../../src/core/client.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env.local') });
async function testHealth() {
  console.log('🔍 Testing Health Check...');

  const client = new FeishuClient({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  });

  try {
    const health = await client.health();
    console.log('✅ Health check passed:', JSON.stringify(health, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

testHealth().then(success => {
  process.exit(success ? 0 : 1);
});
