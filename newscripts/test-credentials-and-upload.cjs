#!/usr/bin/env node

const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Comprehensive R2 Credentials and Upload Test Script
 * 
 * This script:
 * 1. Validates R2 credential lengths (Cloudflare R2 requires 32 hex chars for access key)
 * 2. Tests S3 client initialization
 * 3. Tests bucket access with ListObjects
 * 4. Creates and uploads a test file to R2
 */

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, symbol, message) {
  console.log(`${color}${symbol} ${message}${colors.reset}`);
}

function validateCredentials() {
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}🔐 Step 1: Validating R2 Credentials${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}\n`);

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_BASE_PATH;

  // Check presence
  const envVars = {
    'CLOUDFLARE_ACCOUNT_ID': accountId,
    'CLOUDFLARE_ACCESS_KEY_ID': accessKeyId,
    'CLOUDFLARE_SECRET_ACCESS_KEY': secretAccessKey,
    'R2_BUCKET_NAME': bucketName,
    'R2_BASE_PATH': endpoint
  };

  let allPresent = true;
  for (const [key, value] of Object.entries(envVars)) {
    if (key === 'R2_BASE_PATH') {
      // Optional, show it if present
      if (value) {
        log(colors.green, '✅', `${key}: Set (${value})`);
      } else {
        log(colors.yellow, 'ℹ️ ', `${key}: Not set (optional - will use default)`);
      }
      continue;
    }
    
    if (value) {
      log(colors.green, '✅', `${key}: Set`);
    } else {
      log(colors.red, '❌', `${key}: Missing`);
      allPresent = false;
    }
  }

  if (!allPresent) {
    console.log(`\n${colors.red}❌ Missing required environment variables!${colors.reset}`);
    console.log(`\nPlease set these in your .env file or environment:\n`);
    console.log(`CLOUDFLARE_ACCOUNT_ID=your_account_id`);
    console.log(`CLOUDFLARE_ACCESS_KEY_ID=your_32_char_access_key`);
    console.log(`CLOUDFLARE_SECRET_ACCESS_KEY=your_secret_key`);
    console.log(`R2_BUCKET_NAME=your_bucket_name`);
    console.log(`R2_BASE_PATH=https://your_account_id.r2.cloudflarestorage.com (optional)\n`);
    return null;
  }

  // Validate credential lengths
  console.log(`\n${colors.cyan}📏 Validating credential lengths...${colors.reset}\n`);

  const accessKeyLength = accessKeyId.trim().length;
  const secretKeyLength = secretAccessKey.trim().length;

  // Cloudflare R2 access keys should be exactly 32 hexadecimal characters
  const isAccessKeyValid = accessKeyLength === 32 && /^[a-f0-9]{32}$/i.test(accessKeyId.trim());
  
  if (isAccessKeyValid) {
    log(colors.green, '✅', `Access Key ID length: ${accessKeyLength} chars (VALID - 32 hex chars)`);
  } else {
    log(colors.red, '❌', `Access Key ID length: ${accessKeyLength} chars (INVALID - should be 32 hex chars)`);
    log(colors.yellow, '⚠️ ', `Access Key format: ${/^[a-f0-9]+$/i.test(accessKeyId.trim()) ? 'Hexadecimal' : 'Not hexadecimal'}`);
  }

  // Secret key length varies but should be substantial
  if (secretKeyLength >= 40) {
    log(colors.green, '✅', `Secret Access Key length: ${secretKeyLength} chars (VALID)`);
  } else {
    log(colors.yellow, '⚠️ ', `Secret Access Key length: ${secretKeyLength} chars (seems short)`);
  }

  if (!isAccessKeyValid) {
    console.log(`\n${colors.red}❌ CREDENTIAL ERROR DETECTED!${colors.reset}`);
    console.log(`\nYour access key has ${accessKeyLength} characters, but Cloudflare R2 requires exactly 32.`);
    console.log(`\n${colors.yellow}💡 This is the same error your backend service is encountering!${colors.reset}`);
    console.log(`\nTo fix this:`);
    console.log(`1. Go to Cloudflare Dashboard > R2 > Manage R2 API Tokens`);
    console.log(`2. Create a new R2 API Token with appropriate permissions`);
    console.log(`3. Copy the Access Key ID (should be exactly 32 hex characters)`);
    console.log(`4. Update your .env file with the correct credentials\n`);
    return null;
  }

  return {
    accountId: accountId.trim(),
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
    bucketName: bucketName.trim(),
    endpoint: endpoint ? endpoint.trim() : `https://${accountId.trim()}.r2.cloudflarestorage.com`
  };
}

async function testS3ClientConnection(config) {
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}🔌 Step 2: Testing S3 Client Connection${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}\n`);

  log(colors.cyan, '🌐', `Endpoint: ${config.endpoint}`);
  log(colors.cyan, '📦', `Bucket: ${config.bucketName}`);

  try {
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });

    log(colors.green, '✅', 'S3 Client initialized successfully');

    // Test bucket access with ListObjects
    console.log(`\n${colors.cyan}📋 Testing bucket access...${colors.reset}`);
    
    const listCommand = new ListObjectsV2Command({
      Bucket: config.bucketName,
      MaxKeys: 5
    });

    const listResult = await s3Client.send(listCommand);
    
    log(colors.green, '✅', `Bucket access successful!`);
    log(colors.green, 'ℹ️ ', `Objects in bucket: ${listResult.KeyCount || 0}`);
    
    if (listResult.Contents && listResult.Contents.length > 0) {
      console.log(`\n${colors.cyan}First few objects:${colors.reset}`);
      listResult.Contents.slice(0, 3).forEach(obj => {
        console.log(`   - ${obj.Key} (${obj.Size} bytes)`);
      });
    }

    return s3Client;
  } catch (error) {
    log(colors.red, '❌', `Connection failed: ${error.message}`);
    
    if (error.message.includes('InvalidAccessKeyId')) {
      console.log(`\n${colors.yellow}💡 Invalid Access Key ID - check your credentials${colors.reset}`);
    } else if (error.message.includes('SignatureDoesNotMatch')) {
      console.log(`\n${colors.yellow}💡 Invalid Secret Access Key - check your credentials${colors.reset}`);
    } else if (error.message.includes('NoSuchBucket')) {
      console.log(`\n${colors.yellow}💡 Bucket '${config.bucketName}' not found - check bucket name${colors.reset}`);
    }
    
    throw error;
  }
}

async function createTestFile() {
  const testDir = path.join(__dirname, '.test-uploads');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testFilePath = path.join(testDir, 'test-upload.txt');
  const testContent = `R2 Upload Test
Generated at: ${new Date().toISOString()}
This is a test file to verify R2 upload functionality.
If you can see this file in your R2 bucket, the upload was successful!
`;

  fs.writeFileSync(testFilePath, testContent);
  return testFilePath;
}

async function testFileUpload(s3Client, config) {
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}📤 Step 3: Testing File Upload${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}\n`);

  const testFilePath = await createTestFile();
  log(colors.cyan, '📄', `Created test file: ${testFilePath}`);

  const testKey = `test-uploads/test-${Date.now()}.txt`;
  log(colors.cyan, '🎯', `Target key: ${testKey}`);

  try {
    const fileContent = fs.readFileSync(testFilePath);
    
    const uploadCommand = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: testKey,
      Body: fileContent,
      ContentType: 'text/plain'
    });

    console.log(`\n${colors.cyan}⏳ Uploading file...${colors.reset}`);
    await s3Client.send(uploadCommand);

    log(colors.green, '✅', 'File uploaded successfully!');
    
    const publicUrl = `${config.endpoint}/${config.bucketName}/${testKey}`;
    console.log(`\n${colors.cyan}📍 File location:${colors.reset}`);
    console.log(`   ${publicUrl}`);

    // Clean up test file
    fs.unlinkSync(testFilePath);
    log(colors.green, '🧹', 'Cleaned up local test file');

    return true;
  } catch (error) {
    log(colors.red, '❌', `Upload failed: ${error.message}`);
    throw error;
  }
}

async function main() {
  console.log(`\n${colors.bright}${colors.blue}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}🧪 R2 Credentials & Upload Test Suite${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}${'='.repeat(60)}${colors.reset}`);

  try {
    // Step 1: Validate credentials
    const config = validateCredentials();
    if (!config) {
      process.exit(1);
    }

    // Step 2: Test S3 client connection
    const s3Client = await testS3ClientConnection(config);

    // Step 3: Test file upload
    await testFileUpload(s3Client, config);

    // Success summary
    console.log(`\n${colors.bright}${colors.green}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.bright}${colors.green}✅ ALL TESTS PASSED!${colors.reset}`);
    console.log(`${colors.bright}${colors.green}${'='.repeat(60)}${colors.reset}\n`);

    console.log(`${colors.cyan}Your R2 credentials are working correctly!${colors.reset}\n`);
    console.log(`${colors.yellow}⚠️  However, the error you're seeing is from the BACKEND service${colors.reset}`);
    console.log(`${colors.yellow}   at: https://storybook-deployment-service.epinnock.workers.dev${colors.reset}\n`);
    console.log(`${colors.cyan}The backend service has credentials with the wrong length.${colors.reset}`);
    console.log(`${colors.cyan}You need to update the backend's Cloudflare Worker environment variables.${colors.reset}\n`);

    process.exit(0);
  } catch (error) {
    console.log(`\n${colors.bright}${colors.red}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.bright}${colors.red}❌ TEST FAILED${colors.reset}`);
    console.log(`${colors.bright}${colors.red}${'='.repeat(60)}${colors.reset}\n`);

    if (error.stack) {
      console.log(`${colors.red}Error details:${colors.reset}`);
      console.log(error.stack);
    }

    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  validateCredentials,
  testS3ClientConnection,
  testFileUpload
};