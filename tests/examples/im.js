/**
 * IM (Messaging) API Test
 */
import { FeishuClient } from '../src/core/client.js';

async function testIM() {
  console.log('🔍 Testing IM APIs...\n');

  const client = new FeishuClient({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  });

  // Test: Get tenant token
  console.log('1️⃣ Getting tenant token...');
  try {
    const token = await client.getTenantToken();
    console.log('   ✅ Token acquired (will auto-refresh)');
  } catch (error) {
    console.error('   ❌ Failed to get token:', error.message);
    return;
  }

  // Test: Get bot info
  console.log('\n2️⃣ Getting bot info...');
  try {
    const result = await client.bot.getBotInfo();
    console.log('   ✅ Bot info:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    console.error('   ❌ Failed to get bot info:', error.message);
  }

  // Test: List chats (groups)
  console.log('\n3️⃣ Listing chats...');
  try {
    const result = await client.contact.listChats({ page_size: 5 });
    if (result.data && result.data.chats) {
      console.log(`   ✅ Found ${result.data.chats.length} chats`);
      result.data.chats.forEach(chat => {
        console.log(`   - ${chat.name || chat.chat_id} (${chat.chat_type})`);
      });
    } else {
      console.log('   ℹ️  No chats found or bot not in any chat');
    }
  } catch (error) {
    console.error('   ❌ Failed to list chats:', error.message);
  }

  console.log('\n✅ IM API tests completed');
}

testIM().catch(console.error);
