#!/usr/bin/env node

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { config } from 'dotenv';

// Load environment variables
config();

// R2 Configuration from environment
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.CLOUDFLARE_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;

console.log('🧪 Listing R2 Bucket Contents');
console.log('==============================');

async function listR2Contents() {
  try {
    console.log(`\n📋 Configuration Check:`);
    console.log(`   Account ID: ${accountId ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Access Key ID: ${accessKeyId ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Secret Access Key: ${secretAccessKey ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Bucket Name: ${bucketName || '❌ Missing'}`);

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      throw new Error('Missing required R2 configuration');
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

    console.log(`\n📁 Listing objects in bucket: ${bucketName}`);
    
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      MaxKeys: 100
    });

    const response = await s3Client.send(command);
    
    if (!response.Contents || response.Contents.length === 0) {
      console.log(`   📄 No objects found in bucket`);
      return;
    }

    console.log(`   📄 Found ${response.Contents.length} objects:`);
    console.log(`   ${'='.repeat(60)}`);

    for (const object of response.Contents) {
      const size = object.Size ? `${(object.Size / 1024).toFixed(1)}KB` : 'N/A';
      const modified = object.LastModified ? object.LastModified.toISOString().split('T')[0] : 'N/A';
      console.log(`   📎 ${object.Key}`);
      console.log(`      Size: ${size}, Modified: ${modified}`);
    }

    // Check for the specific key that was failing
    const testKey = 'scry-nextjs/Primary.png';
    const hasTestKey = response.Contents.some(obj => obj.Key === testKey);
    console.log(`\n🔍 Test key '${testKey}': ${hasTestKey ? '✅ EXISTS' : '❌ NOT FOUND'}`);

    if (response.IsTruncated) {
      console.log(`\n⚠️  Note: Results truncated, there may be more objects`);
    }

    return true;
  } catch (error) {
    console.error(`\n❌ Failed to list bucket contents: ${error.message}`);
    return false;
  }
}

// Main execution
async function main() {
  const success = await listR2Contents();
  
  console.log(`\n📊 Listing Summary`);
  console.log('==================');
  console.log(`R2 Bucket Listing: ${success ? '✅ SUCCESS' : '❌ FAILED'}`);
  
  process.exit(success ? 0 : 1);
}

main().catch(console.error);