/**
 * Approval Examples
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
    console.log('🔐 Approval Examples\n');

    await feishu.ensureToken();

    // ============ List Approval Templates ============
    console.log('1️⃣  Listing approval templates...');
    const templates = await feishu.approval.listApprovalDefinitions({ pageSize: 10 });
    console.log(`   Found ${templates.data.approval_templates?.length || 0} templates`);
    let templateId = null;

    if (templates.data.approval_templates?.length > 0) {
      const template = templates.data.approval_templates[0];
      console.log('   First template:', template.name);
      console.log('   Template ID:', template.approval_template_id);
      templateId = template.approval_template_id;
    } else {
      console.log('   ⚠️  No approval templates found.');
      console.log('   Create an approval template in your Feishu admin console first.');
    }

    if (templateId) {
      // ============ Get Template Detail ============
      console.log('\n2️⃣  Getting template detail...');
      const template = await feishu.approval.getApprovalDefinition(templateId);
      console.log('   Template name:', template.data.name);
      console.log('   Form content:', JSON.stringify(template.data.form).substring(0, 200) + '...');

      // ============ Create Approval Instance ============
      console.log('\n3️⃣  Creating approval instance...');
      const instanceResult = await feishu.approval.createInstance(templateId, {
        title: 'Test Approval Request',
        form: template.data.form, // Use the template's form structure
        user_ids: [], // You can specify approvers here
      });
      console.log('   Instance created:', instanceResult.data.instance_id);
      const instanceId = instanceResult.data.instance_id;

      // ============ Get Instance ============
      console.log('\n4️⃣  Getting instance...');
      const instance = await feishu.approval.getInstance(instanceId);
      console.log('   Title:', instance.data.title);
      console.log('   Status:', instance.data.status);

      // ============ List Instances ============
      console.log('\n5️⃣  Listing instances...');
      const instances = await feishu.approval.listInstances({ pageSize: 10 });
      console.log(`   Found ${instances.data.instance_ids?.length || 0} instances`);

      // ============ Get Approval Tasks ============
      console.log('\n6️⃣  Getting approval tasks...');
      const tasks = await feishu.approval.listApprovalTasks({ pageSize: 10 });
      console.log(`   Found ${tasks.data.task_ids?.length || 0} tasks`);

      // ============ Complete Task (if exists) ============
      if (tasks.data.task_ids?.length > 0) {
        const taskId = tasks.data.task_ids[0];
        console.log('\n7️⃣  Approving task...');
        try {
          await feishu.approval.approveTask(taskId, 'Approved via API 🎉');
          console.log('   ✅ Task approved');
        } catch (error) {
          console.log('   ⚠️  Cannot approve (may require specific status or permissions)');
        }
      }

      // ============ Cancel Instance ============
      console.log('\n8️⃣  Canceling instance...');
      await feishu.approval.cancelInstance(instanceId, 'Test completed');
      console.log('   ✅ Instance canceled');
    }

    console.log('\n✅ Approval examples complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Details:', error.details || {});
    process.exit(1);
  }
}

main();
