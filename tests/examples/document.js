/**
 * Document & Spreadsheet Examples
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
    console.log('📄 Document & Spreadsheet Examples\n');

    await feishu.ensureToken();

    // ============ Create Document ============
    console.log('1️⃣  Creating document...');
    const docResult = await feishu.doc.createDocument('My New Document', 'doc');
    console.log('   Document created:', docResult.data.document_id);
    const docId = docResult.data.document_id;

    // ============ Get Document ============
    console.log('\n2️⃣  Getting document info...');
    const docInfo = await feishu.doc.getDocument(docId);
    console.log('   Title:', docInfo.data.title);
    console.log('   URL:', docInfo.data.url);

    // ============ Update Document Title ============
    console.log('\n3️⃣  Updating document title...');
    await feishu.doc.updateDocumentTitle(docId, 'Updated Document Title 🎉');
    const updatedDoc = await feishu.doc.getDocument(docId);
    console.log('   New title:', updatedDoc.data.title);

    // ============ Get Document Content ============
    console.log('\n4️⃣  Getting document content...');
    const content = await feishu.doc.getDocumentContent(docId);
    console.log('   Content:', JSON.stringify(content).substring(0, 200) + '...');

    // ============ Create Spreadsheet ============
    console.log('\n5️⃣  Creating spreadsheet...');
    const sheetResult = await feishu.doc.createSpreadsheet('My Spreadsheet');
    console.log('   Spreadsheet created:', sheetResult.data.spreadsheet_token);
    const sheetToken = sheetResult.data.spreadsheet_token;

    // ============ Read Spreadsheet Values ============
    console.log('\n6️⃣  Reading spreadsheet values...');
    const sheetValues = await feishu.doc.getSheetValues(sheetToken, 'Sheet1', 'A1:Z10');
    console.log('   Values:', JSON.stringify(sheetValues.data.value || []).substring(0, 200) + '...');

    // ============ Write to Spreadsheet ============
    console.log('\n7️⃣  Writing to spreadsheet...');
    await feishu.doc.updateSheetValues(sheetToken, 'Sheet1', 'A1:B2', [
      ['Name', 'Score'],
      ['Alice', '100'],
      ['Bob', '95'],
    ]);
    console.log('   ✅ Values updated');

    // ============ Append Rows ============
    console.log('\n8️⃣  Appending rows...');
    await feishu.doc.appendSheetRows(sheetToken, 'Sheet1', [
      ['Charlie', '98'],
      ['David', '87'],
    ]);
    console.log('   ✅ Rows appended');

    // ============ Delete Document ============
    console.log('\n9️⃣  Deleting document...');
    await feishu.doc.deleteDocument(docId);
    console.log('   ✅ Document deleted');

    // Note: We keep the spreadsheet for you to inspect

    console.log('\n✅ Document examples complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Details:', error.details || {});
    process.exit(1);
  }
}

main();
