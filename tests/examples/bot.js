/**
 * Bot Examples
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
    console.log('🤖 Bot Examples\n');

    await feishu.ensureToken();

    // ============ Get Bot Info ============
    console.log('1️⃣  Getting bot info...');
    const botInfo = await feishu.bot.getBotInfo();
    console.log('   Bot name:', botInfo.data.name);
    console.log('   Bot description:', botInfo.data.description);
    console.log('   Bot avatar:', botInfo.data.avatar_url);
    console.log('   Bot ID:', botInfo.data.bot_id);

    // ============ Update Bot Info ============
    console.log('\n2️⃣  Updating bot info...');
    await feishu.bot.updateBotInfo({
      name: 'My Awesome Bot 🤖',
      description: 'A bot powered by Feishu Connect SDK',
    });
    console.log('   ✅ Bot info updated');

    // ============ Get Bot Members ============
    console.log('\n3️⃣  Getting bot members (chats where bot is added)...');
    const members = await feishu.bot.getBotChatMembers({ pageSize: 20 });
    console.log(`   Bot is in ${members.data.items?.length || 0} chats`);
    if (members.data.items?.length > 0) {
      console.log('   Chat names:', members.data.items.map(i => i.name).join(', '));
    }

    // ============ Get Bot Member Count ============
    console.log('\n4️⃣  Getting total member count...');
    const countResult = await feishu.bot.getBotChatMemberCount();
    console.log('   Total members:', countResult.data.count);

    // ============ Set Bot Help Text ============
    console.log('\n5️⃣  Setting bot help text...');
    await feishu.bot.setBotHelpText(
      'Available commands:\n' +
      '- /help - Show this help\n' +
      '- /status - Check bot status\n' +
      '- /version - Show bot version'
    );
    console.log('   ✅ Help text updated');

    // ============ Set Bot Description ============
    console.log('\n6️⃣  Setting bot description...');
    await feishu.bot.setBotDescription(
      'This bot is powered by Feishu Connect SDK v2.0. It can help you manage tasks, documents, and more! 🚀'
    );
    console.log('   ✅ Description updated');

    // ============ Get Outgoing Webhook ============
    console.log('\n7️⃣  Getting outgoing webhook URL...');
    try {
      const webhook = await feishu.bot.getOutgoingWebhook();
      console.log('   Webhook URL:', webhook.data.url);
    } catch (error) {
      console.log('   ⚠️  No webhook URL set (this is normal)');
      console.log('   Set it with: feishu.bot.setOutgoingWebhook("https://your-server.com/webhook")');
    }

    console.log('\n✅ Bot examples complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Details:', error.details || {});
    process.exit(1);
  }
}

main();
