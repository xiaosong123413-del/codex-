/**
 * Task Examples
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
    console.log('✅ Task Examples\n');

    await feishu.ensureToken();

    // ============ Create Task List ============
    console.log('1️⃣  Creating task list...');
    const listResult = await feishu.task.createTaskList('Project Tasks', 'Tasks for our project');
    console.log('   Task list created:', listResult.data.task_list_id);
    const taskListId = listResult.data.task_list_id;

    // ============ Get Task List ============
    console.log('\n2️⃣  Getting task list...');
    const taskList = await feishu.task.getTaskList(taskListId);
    console.log('   Name:', taskList.data.name);
    console.log('   Description:', taskList.data.description);

    // ============ Create Task ============
    console.log('\n3️⃣  Creating task...');
    const taskResult = await feishu.task.createTask(taskListId, {
      title: 'Complete project documentation',
      description: 'Write comprehensive documentation for the project',
      due: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
      priority: 'high',
    });
    console.log('   Task created:', taskResult.data.task_id);
    const taskId = taskResult.data.task_id;

    // ============ Get Task ============
    console.log('\n4️⃣  Getting task details...');
    const task = await feishu.task.getTask(taskId);
    console.log('   Title:', task.data.title);
    console.log('   Status:', task.data.status);
    console.log('   Priority:', task.data.priority);

    // ============ Update Task ============
    console.log('\n5️⃣  Updating task...');
    await feishu.task.updateTask(taskId, {
      title: 'Complete project documentation with examples 📝',
      description: 'Write comprehensive docs with code examples',
    });
    const updatedTask = await feishu.task.getTask(taskId);
    console.log('   Updated title:', updatedTask.data.title);

    // ============ Add Comment ============
    console.log('\n6️⃣  Adding comment...');
    await feishu.task.addTaskComment(taskId, 'This is an important task!');
    const comments = await feishu.task.getTaskComments(taskId);
    console.log('   Total comments:', comments.data.items?.length || 0);

    // ============ Complete Task ============
    console.log('\n7️⃣  Completing task...');
    await feishu.task.completeTask(taskId);
    const completedTask = await feishu.task.getTask(taskId);
    console.log('   Status:', completedTask.data.status);

    // ============ Reopen Task ============
    console.log('\n8️⃣  Reopening task...');
    await feishu.task.reopenTask(taskId);
    const reopenedTask = await feishu.task.getTask(taskId);
    console.log('   Status:', reopenedTask.data.status);

    // ============ List Tasks ============
    console.log('\n9️⃣  Listing tasks in list...');
    const tasks = await feishu.task.listTasks(taskListId, { pageSize: 10 });
    console.log(`   Found ${tasks.data.items?.length || 0} tasks`);

    // ============ Delete Task ============
    console.log('\n🔟  Deleting task...');
    await feishu.task.deleteTask(taskId);
    console.log('   ✅ Task deleted');

    // ============ Delete Task List ============
    console.log('\n1️⃣1️⃣  Deleting task list...');
    await feishu.task.deleteTaskList(taskListId);
    console.log('   ✅ Task list deleted');

    console.log('\n✅ Task examples complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Details:', error.details || {});
    process.exit(1);
  }
}

main();
