#!/usr/bin/env node

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from 'dotenv';

// Load environment variables
config();

// Simple URL parsing functions for testing
function isR2Url(input) {
  try {
    const u = new URL(input);
    return u.hostname.includes("r2.cloudflarestorage.com");
  } catch {
    return false;
  }
}

function extractBucketAndKeyFromR2Url(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  const host = u.hostname;
  const path = u.pathname.replace(/^\/+/, ""); // strip leading slash

  // Format: https://{bucket}.{accountId}.r2.cloudflarestorage.com/{key...}
  if (host.includes("r2.cloudflarestorage.com")) {
    const hostParts = host.split(".");
    // hostParts should be: [bucket, accountId, "r2", "cloudflarestorage", "com"]
    if (hostParts.length >= 5 && hostParts[2] === "r2" && hostParts[3] === "cloudflarestorage") {
      const bucket = hostParts[0];
      const key = path || "";
      return { bucket, key };
    }
  }

  return null;
}

function extractStorageKey(input, expectedBucket) {
  // If input is a URL, try to parse it
  if (isR2Url(input)) {
    const parsed = extractBucketAndKeyFromR2Url(input);
    if (!parsed) return null;
    if (expectedBucket && parsed.bucket !== expectedBucket) {
      // Bucket mismatch - reject to avoid cross-bucket access
      return null;
    }
    return parsed.key;
  }

  // Otherwise treat input as already being a key (e.g., "scry-nextjs/Primary.png")
  // Reject obvious absolutes to avoid path traversal
  if (input.startsWith("http://") || input.startsWith("https://")) return null;
  if (input.startsWith("/") || input.includes("..")) return null;

  return input;
}

function getStorageProvider(url) {
  if (isR2Url(url)) return 'r2';
  return 'unknown';
}

// R2 Configuration
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.CLOUDFLARE_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;

console.log('🧪 Testing R2 Presigned URL Generation');
console.log('=====================================');

// Test R2 URL from the user's example
const testR2Url = 'https://scry-component-snapshot-bucket.f54b9c10de9d140756dbf449aa124f1e.r2.cloudflarestorage.com/scry-nextjs/Primary.png';

async function testR2PresignedUrl() {
  try {
    console.log(`\n📋 Configuration Check:`);
    console.log(`   Account ID: ${accountId ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Access Key ID: ${accessKeyId ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Secret Access Key: ${secretAccessKey ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Bucket Name: ${bucketName || '❌ Missing'}`);

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      throw new Error('Missing required R2 configuration');
    }

    console.log(`\n🔍 Testing URL: ${testR2Url}`);
    
    // Test URL parsing
    const provider = getStorageProvider(testR2Url);
    console.log(`   Storage Provider: ${provider}`);
    
    const key = extractStorageKey(testR2Url, bucketName);
    console.log(`   Extracted Key: ${key}`);
    
    if (!key) {
      throw new Error('Failed to extract key from R2 URL');
    }

    // Initialize S3 client for R2
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    console.log(`   R2 Endpoint: ${endpoint}`);

    const s3Client = new S3Client({
      endpoint,
      region: 'auto',
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      forcePathStyle: true
    });

    console.log(`\n⏳ Generating presigned URL...`);
    
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    });

    const expiresIn = 3600; // 1 hour
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    
    console.log(`\n✅ Presigned URL generated successfully!`);
    console.log(`   Original URL: ${testR2Url}`);
    console.log(`   Presigned URL: ${presignedUrl.substring(0, 100)}...`);
    console.log(`   Expires in: ${expiresIn} seconds (${expiresIn/60} minutes)`);
    
    // Test if the presigned URL is accessible
    console.log(`\n🌐 Testing presigned URL accessibility...`);
    
    try {
      const response = await fetch(presignedUrl, { method: 'HEAD' });
      console.log(`   HTTP Status: ${response.status} ${response.statusText}`);
      console.log(`   Content-Type: ${response.headers.get('content-type') || 'N/A'}`);
      console.log(`   Content-Length: ${response.headers.get('content-length') || 'N/A'} bytes`);
      
      if (response.ok) {
        console.log(`   ✅ Presigned URL is accessible!`);
      } else {
        console.log(`   ⚠️ Presigned URL returned error status`);
      }
    } catch (fetchError) {
      console.log(`   ❌ Failed to test presigned URL: ${fetchError.message}`);
    }

    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    return false;
  }
}

// Test different URL formats
async function testMultipleUrls() {
  const testUrls = [
    'https://scry-component-snapshot-bucket.f54b9c10de9d140756dbf449aa124f1e.r2.cloudflarestorage.com/scry-nextjs/Primary.png',
    'scry-nextjs/Primary.png', // Direct key
    'scry-nextjs/Button.png'   // Another direct key
  ];

  console.log(`\n🧪 Testing Multiple URL Formats`);
  console.log('=================================');

  for (const testUrl of testUrls) {
    console.log(`\n📝 Testing: ${testUrl}`);
    
    try {
      const provider = getStorageProvider(testUrl);
      const key = extractStorageKey(testUrl, bucketName);
      
      console.log(`   Provider: ${provider}`);
      console.log(`   Key: ${key}`);
      
      if (key) {
        console.log(`   ✅ URL parsing successful`);
      } else {
        console.log(`   ❌ Failed to extract key`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
}

// Main execution
async function main() {
  const success = await testR2PresignedUrl();
  await testMultipleUrls();
  
  console.log(`\n📊 Test Summary`);
  console.log('================');
  console.log(`R2 Presigned URL Test: ${success ? '✅ PASSED' : '❌ FAILED'}`);
  
  process.exit(success ? 0 : 1);
}

main().catch(console.error);