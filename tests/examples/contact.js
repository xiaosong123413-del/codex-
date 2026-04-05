/**
 * Contact (Users & Departments) Examples
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
    console.log('👥 Contact Examples\n');

    await feishu.ensureToken();

    // ============ Get Bot Info ============
    console.log('1️⃣  Getting bot info...');
    const botInfo = await feishu.bot.getBotInfo();
    console.log('   Bot:', JSON.stringify(botInfo.data, null, 2));

    // ============ List Departments ============
    console.log('\n2️⃣  Listing departments...');
    const departments = await feishu.contact.listDepartments();
    console.log(`   Found ${departments.data.items?.length || 0} departments`);
    if (departments.data.items?.length > 0) {
      console.log('   First department:', departments.data.items[0].name);
    }

    // ============ List Users ============
    console.log('\n3️⃣  Listing users...');
    const users = await feishu.contact.listUsers({ pageSize: 10 });
    console.log(`   Found ${users.data.items?.length || 0} users`);
    if (users.data.items?.length > 0) {
      const user = users.data.items[0];
      console.log('   First user:', user.name, `(${user.user_id})`);
    }

    // ============ Get User Detail ============
    if (users.data.items?.length > 0) {
      console.log('\n4️⃣  Getting user detail...');
      const userId = users.data.items[0].user_id;
      const userDetail = await feishu.contact.getUser(userId);
      console.log('   Email:', userDetail.data.email);
      console.log('   Mobile:', userDetail.data.mobile);
    }

    // ============ List Chats ============
    console.log('\n5️⃣  Listing chats (groups)...');
    const chats = await feishu.contact.listChats({ pageSize: 10 });
    console.log(`   Found ${chats.data.items?.length || 0} chats`);
    if (chats.data.items?.length > 0) {
      console.log('   First chat:', chats.data.items[0].name);
    }

    // ============ Get Chat Members ============
    if (chats.data.items?.length > 0) {
      console.log('\n6️⃣  Getting chat members...');
      const chatId = chats.data.items[0].chat_id;
      const members = await feishu.contact.getChatMembers(chatId);
      console.log(`   Chat has ${members.data.items?.length || 0} members`);
    }

    console.log('\n✅ Contact examples complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Details:', error.details || {});
    process.exit(1);
  }
}

main();
