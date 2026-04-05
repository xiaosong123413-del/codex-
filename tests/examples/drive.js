/**
 * Drive (Files) Examples
 */

import { FeishuClient } from '../src/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const feishu = new FeishuClient();

if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
  console.error('❌ Please set FEISHU_APP_ID and FEISHU_APP_SECRET');
  process.exit(1);
}

feishu.init(process.env.FEISHU_APP_ID, process.env.FEISHU_APP_SECRET);

async function main() {
  try {
    console.log('📁 Drive (Files) Examples\n');

    await feishu.ensureToken();

    // ============ Create Folder ============
    console.log('1️⃣  Creating folder...');
    const folderResult = await feishu.drive.createFolder('My Test Folder');
    console.log('   Folder created:', folderResult.data.token);
    const folderToken = folderResult.data.token;

    // ============ Create Test File ============
    console.log('\n2️⃣  Creating test file...');
    const testFilePath = path.join(__dirname, 'test-file.txt');
    fs.writeFileSync(testFilePath, 'This is a test file uploaded via Feishu API! 🎉\n');
    console.log('   Test file created locally');

    // ============ Upload File ============
    console.log('\n3️⃣  Uploading file...');
    const uploadResult = await feishu.drive.uploadFile(testFilePath, 'test-file.txt', folderToken);
    console.log('   File uploaded:', uploadResult.file_token);
    const fileToken = uploadResult.file_token;

    // Clean up local test file
    fs.unlinkSync(testFilePath);

    // ============ Get File Info ============
    console.log('\n4️⃣  Getting file info...');
    const fileInfo = await feishu.drive.getFile(fileToken);
    console.log('   Name:', fileInfo.data.name);
    console.log('   Size:', fileInfo.data.size);
    console.log('   URL:', fileInfo.data.url);

    // ============ List Folder Contents ============
    console.log('\n5️⃣  Listing folder contents...');
    const folderContents = await feishu.drive.listFolder(folderToken);
    console.log(`   Folder has ${folderContents.data.items?.length || 0} items`);

    // ============ Download File ============
    console.log('\n6️⃣  Downloading file...');
    const fileBuffer = await feishu.drive.downloadFile(fileToken);
    console.log('   Downloaded', fileBuffer.length, 'bytes');

    // ============ Search Files ============
    console.log('\n7️⃣  Searching files...');
    const searchResult = await feishu.drive.searchFiles('test-file');
    console.log(`   Found ${searchResult.data.files?.length || 0} matching files`);

    // ============ Copy File ============
    console.log('\n8️⃣  Copying file...');
    const copyResult = await feishu.drive.copyFile(fileToken, folderToken);
    console.log('   Copied file token:', copyResult.data.file_token);

    // ============ Move File ============
    console.log('\n9️⃣  Moving copied file to root...');
    // First get root folder token (usually is '')
    // await feishu.drive.moveFile(copyResult.data.file_token, '');
    console.log('   ⚠️  Moving requires valid root folder token');

    // ============ Delete File ============
    console.log('\n🔟  Deleting files...');
    await feishu.drive.deleteFile(copyResult.data.file_token);
    console.log('   ✅ Copied file deleted');

    await feishu.drive.deleteFile(fileToken);
    console.log('   ✅ Original file deleted');

    // ============ Delete Folder ============
    console.log('\n1️⃣1️⃣  Deleting folder...');
    await feishu.drive.deleteFile(folderToken);
    console.log('   ✅ Folder deleted');

    console.log('\n✅ Drive examples complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Details:', error.details || {});
    process.exit(1);
  }
}

main();
