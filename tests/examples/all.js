/**
 * Comprehensive API Test Suite
 */
import { FeishuClient } from '../src/core/client.js';

async function runAllTests() {
  console.log('🚀 Starting Feishu API Test Suite\n');
  console.log('=' .repeat(50));

  const client = new FeishuClient({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  });

  const results = [];

  // Test 1: Health & Auth
  console.log('\n📋 Test Suite: Authentication & Health');
  try {
    const health = await client.health();
    console.log('  ✅ Health check passed');
    results.push({ name: 'Health', passed: true });
  } catch (error) {
    console.error('  ❌ Health check failed:', error.message);
    results.push({ name: 'Health', passed: false, error: error.message });
  }

  // Test 2: Bot Info
  try {
    const bot = await client.bot.getBotInfo();
    console.log('  ✅ Bot info retrieved');
    results.push({ name: 'Bot Info', passed: true });
  } catch (error) {
    console.error('  ❌ Bot info failed:', error.message);
    results.push({ name: 'Bot Info', passed: false, error: error.message });
  }

  // Test 3: List Users
  console.log('\n📋 Test Suite: Contacts');
  try {
    const users = await client.contact.listUsers({ page_size: 1 });
    console.log('  ✅ List users passed');
    results.push({ name: 'List Users', passed: true });
  } catch (error) {
    console.error('  ❌ List users failed:', error.message);
    results.push({ name: 'List Users', passed: false, error: error.message });
  }

  // Test 4: List Departments
  try {
    const depts = await client.contact.listDepartments({ page_size: 1 });
    console.log('  ✅ List departments passed');
    results.push({ name: 'List Departments', passed: true });
  } catch (error) {
    console.error('  ❌ List departments failed:', error.message);
    results.push({ name: 'List Departments', passed: false, error: error.message });
  }

  // Test 5: List Chats
  try {
    const chats = await client.contact.listChats({ page_size: 1 });
    console.log('  ✅ List chats passed');
    results.push({ name: 'List Chats', passed: true });
  } catch (error) {
    console.error('  ❌ List chats failed:', error.message);
    results.push({ name: 'List Chats', passed: false, error: error.message });
  }

  // Test 6: Create Document
  console.log('\n📋 Test Suite: Documents');
  try {
    const doc = await client.doc.createDocument('Test Document from API', 'doc');
    console.log('  ✅ Create document passed (ID: %s)', doc.data.document?.document_id);
    results.push({ name: 'Create Document', passed: true });

    // Cleanup
    try {
      await client.doc.deleteDocument(doc.data.document.document_id);
      console.log('  ✅ Cleaned up test document');
    } catch (e) {
      // Ignore cleanup errors
    }
  } catch (error) {
    console.error('  ❌ Create document failed:', error.message);
    results.push({ name: 'Create Document', passed: false, error: error.message });
  }

  // Test 7: List Drive Folders
  console.log('\n📋 Test Suite: Drive');
  try {
    const folders = await client.drive.listFolder('root', { page_size: 1 });
    console.log('  ✅ List root folder passed');
    results.push({ name: 'List Root Folder', passed: true });
  } catch (error) {
    console.error('  ❌ List root folder failed:', error.message);
    results.push({ name: 'List Root Folder', passed: false, error: message });
  }

  // Test 8: List Calendars
  console.log('\n📋 Test Suite: Calendar');
  try {
    const calendars = await client.calendar.listCalendars({ page_size: 1 });
    console.log('  ✅ List calendars passed');
    results.push({ name: 'List Calendars', passed: true });
  } catch (error) {
    console.error('  ❌ List calendars failed:', error.message);
    results.push({ name: 'List Calendars', passed: false, error: error.message });
  }

  // Test 9: List Approval Definitions
  console.log('\n📋 Test Suite: Approval');
  try {
    const defs = await client.approval.listApprovalDefinitions({ page_size: 1 });
    console.log('  ✅ List approval definitions passed');
    results.push({ name: 'List Approval Definitions', passed: true });
  } catch (error) {
    console.error('  ❌ List approval definitions failed:', error.message);
    results.push({ name: 'List Approval Definitions', passed: false, error: error.message });
  }

  // Test 10: List Task Lists
  console.log('\n📋 Test Suite: Tasks');
  try {
    const taskLists = await client.task.listTaskLists({ page_size: 1 });
    console.log('  ✅ List task lists passed');
    results.push({ name: 'List Task Lists', passed: true });
  } catch (error) {
    console.error('  ❌ List task lists failed:', error.message);
    results.push({ name: 'List Task Lists', passed: false, error: error.message });
  }

  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log('📊 Test Summary:');
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`   Passed: ${passed}/${total}`);
  results.forEach(r => {
    console.log(`   ${r.passed ? '✅' : '❌'} ${r.name}${r.error ? `: ${r.error}` : ''}`);
  });

  console.log('\n🎯 Overall: ${passed === total ? '✅ ALL TESTS PASSED' : '⚠️  SOME TESTS FAILED'}');
}

runAllTests().catch(console.error);
