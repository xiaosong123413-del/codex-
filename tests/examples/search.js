/**
 * Search Examples
 */

import { FeishuClient } from '../src/index.js';

const feishu = new FeishuClient();

if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
  console.error('❌ Please set FEISHU_APP_ID and FEISHU_APP_SECRET');
  process.exit(1);
}

feishu.init(process.env.FEISHU_APP_ID, process.env.FEISHU_APP_SECRET);

async function main() {
  try {
    console.log('🔍 Search Examples\n');

    await feishu.ensureToken();

    // ============ Global Search ============
    console.log('1️⃣  Performing global search...');
    // Replace with a meaningful query
    const query = 'meeting';
    const globalResult = await feishu.search.searchAll(query, {
      pageSize: 10,
      searchTypes: ['message', 'doc', 'user'],
    });
    console.log('   Global search completed');
    console.log('   Results:', JSON.stringify(globalResult.data).substring(0, 200) + '...');

    // ============ Search Messages ============
    console.log('\n2️⃣  Searching messages...');
    const messageResult = await feishu.search.searchMessages(query, { pageSize: 10 });
    console.log(`   Found ${messageResult.data.items?.length || 0} messages`);

    // ============ Search Documents ============
    console.log('\n3️⃣  Searching documents...');
    const docResult = await feishu.search.searchDocuments(query, { pageSize: 10 });
    console.log(`   Found ${docResult.data.documents?.length || 0} documents`);

    // ============ Search Users ============
    console.log('\n4️⃣  Searching users...');
    const userResult = await feishu.search.searchUsers(query, { pageSize: 10 });
    console.log(`   Found ${userResult.data.users?.length || 0} users`);

    // ============ Search Files ============
    console.log('\n5️⃣  Searching files...');
    const fileResult = await feishu.search.searchFiles(query, { pageSize: 10 });
    console.log(`   Found ${fileResult.data.files?.length || 0} files`);

    // ============ Search Chats ============
    console.log('\n6️⃣  Searching chats...');
    const chatResult = await feishu.search.searchChats(query, { pageSize: 10 });
    console.log(`   Found ${chatResult.data.chats?.length || 0} chats`);

    console.log('\n✅ Search examples complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Details:', error.details || {});
    process.exit(1);
  }
}

main();
