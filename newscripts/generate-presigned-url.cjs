#!/usr/bin/env node

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from 'dotenv';

// Load environment variables
config();

/**
 * Standalone script to generate a presigned URL for a specific R2 file
 * Target file: https://scry-component-snapshot-bucket.f54b9c10de9d140756dbf449aa124f1e.r2.cloudflarestorage.com/scry-nextjs/Large.png
 */

// Parse R2 URL to extract bucket and key
function parseR2Url(url) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    const pathname = parsedUrl.pathname.replace(/^\/+/, ""); // Remove leading slashes
    
    // Format: https://{bucket}.{accountId}.r2.cloudflarestorage.com/{key}
    if (hostname.includes("r2.cloudflarestorage.com")) {
      const hostParts = hostname.split(".");
      // hostParts: [bucket, accountId, "r2", "cloudflarestorage", "com"]
      if (hostParts.length >= 5 && hostParts[2] === "r2" && hostParts[3] === "cloudflarestorage") {
        return {
          bucket: hostParts[0],
          accountId: hostParts[1],
          key: pathname || ""
        };
      }
    }
    
    throw new Error('Invalid R2 URL format');
  } catch (error) {
    throw new Error(`Failed to parse R2 URL: ${error.message}`);
  }
}

async function generatePresignedUrl() {
  // Target file URL
  const targetUrl = 'https://scry-component-snapshot-bucket.f54b9c10de9d140756dbf449aa124f1e.r2.cloudflarestorage.com/scry-nextjs/Large.png';
  
  console.log('🔗 R2 Presigned URL Generator');
  console.log('=============================');
  console.log(`Target file: ${targetUrl}`);
  
  try {
    // Parse the target URL
    const { bucket, accountId, key } = parseR2Url(targetUrl);
    console.log(`\n📋 Parsed URL:`);
    console.log(`   Bucket: ${bucket}`);
    console.log(`   Account ID: ${accountId}`);
    console.log(`   Key: ${key}`);
    
    // Get R2 credentials from environment variables
    const accessKeyId = process.env.CLOUDFLARE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
    const envBucketName = process.env.R2_BUCKET_NAME;
    
    console.log(`\n🔐 Configuration Check:`);
    console.log(`   Access Key ID: ${accessKeyId ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Secret Access Key: ${secretAccessKey ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Env Bucket Name: ${envBucketName || '❌ Not set'}`);
    
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Missing R2 credentials. Please set CLOUDFLARE_ACCESS_KEY_ID and CLOUDFLARE_SECRET_ACCESS_KEY environment variables.');
    }
    
    // Use bucket from URL, but validate against env if set
    if (envBucketName && envBucketName !== bucket) {
      console.log(`   ⚠️ Warning: Environment bucket (${envBucketName}) differs from URL bucket (${bucket})`);
      console.log(`   Using bucket from URL: ${bucket}`);
    }
    
    // Initialize S3 client for R2
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    console.log(`\n⚙️ Initializing R2 client:`);
    console.log(`   Endpoint: ${endpoint}`);
    
    const s3Client = new S3Client({
      endpoint,
      region: 'auto',
      credentials: {
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim()
      },
      forcePathStyle: true,
      signatureVersion: 'v4'
    });
    
    // Configure expiration (default: 1 hour)
    const expiresIn = process.env.EXPIRES_IN ? parseInt(process.env.EXPIRES_IN) : 3600;
    console.log(`   Expires in: ${expiresIn} seconds (${Math.round(expiresIn/60)} minutes)`);
    
    // Create GetObject command
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    console.log(`\n⏳ Generating presigned URL...`);
    
    // Generate presigned URL
    const presignedUrl = await getSignedUrl(s3Client, command, { 
      expiresIn,
      signableHeaders: new Set(['host'])
    });
    
    console.log(`\n✅ Success! Presigned URL generated:`);
    console.log(`${presignedUrl}`);
    
    // Test accessibility (optional)
    if (process.env.TEST_ACCESS !== 'false') {
      console.log(`\n🌐 Testing URL accessibility...`);
      try {
        const response = await fetch(presignedUrl, { method: 'HEAD' });
        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Content-Type: ${response.headers.get('content-type') || 'N/A'}`);
        console.log(`   Content-Length: ${response.headers.get('content-length') || 'N/A'} bytes`);
        
        if (response.ok) {
          console.log(`   ✅ URL is accessible!`);
        } else {
          console.log(`   ⚠️ URL returned error status`);
        }
      } catch (fetchError) {
        console.log(`   ❌ Accessibility test failed: ${fetchError.message}`);
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Original URL: ${targetUrl}`);
    console.log(`   Presigned URL: ${presignedUrl.substring(0, 80)}...`);
    console.log(`   Valid for: ${Math.round(expiresIn/60)} minutes`);
    
    return presignedUrl;
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// CLI interface
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  console.log(`Environment variables needed:`);
  console.log(`   CLOUDFLARE_ACCESS_KEY_ID=your_access_key_id`);
  console.log(`   CLOUDFLARE_SECRET_ACCESS_KEY=your_secret_access_key`);
  console.log(`   EXPIRES_IN=3600 (optional, default: 1 hour)`);
  console.log(`   TEST_ACCESS=false (optional, set to skip accessibility test)`);
  console.log(``);
  
  generatePresignedUrl().catch(console.error);
}

export { generatePresignedUrl, parseR2Url };