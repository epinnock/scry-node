/**
 * Example usage of the R2Uploader utility
 * 
 * This file demonstrates how to use the R2Uploader class to upload files to Cloudflare R2
 */

const R2Uploader = require('./r2-upload.js');

// Example 1: Initialize with direct configuration
async function example1() {
  console.log('\n📝 Example 1: Direct configuration');
  
  const uploader = new R2Uploader({
    accountId: 'your-cloudflare-account-id',
    accessKeyId: 'your-r2-access-key-id',
    secretAccessKey: 'your-r2-secret-access-key',
    bucketName: 'your-r2-bucket-name',
    publicDomain: 'cdn.yourdomain.com' // Optional: custom domain for public URLs
  });

  try {
    // Upload a single file
    const publicUrl = await uploader.uploadFile('./example.png', 'images/example.png');
    console.log('File uploaded to:', publicUrl);
  } catch (error) {
    console.error('Upload failed:', error.message);
  }
}

// Example 2: Initialize with environment variables
async function example2() {
  console.log('\n📝 Example 2: Environment variables configuration');
  
  // Set these environment variables:
  // CLOUDFLARE_ACCOUNT_ID=your-account-id
  // CLOUDFLARE_ACCESS_KEY_ID=your-access-key
  // CLOUDFLARE_SECRET_ACCESS_KEY=your-secret-key
  // R2_BUCKET_NAME=your-bucket-name
  // R2_PUBLIC_DOMAIN=cdn.yourdomain.com (optional)
  
  const uploader = new R2Uploader(); // Will use environment variables
  
  try {
    // Upload multiple files
    const results = await uploader.uploadFiles([
      './file1.jpg',
      './file2.png',
      './file3.pdf'
    ], 'uploads/'); // Optional base path in R2
    
    console.log('Batch upload results:', results);
  } catch (error) {
    console.error('Batch upload failed:', error.message);
  }
}

// Example 3: Upload with automatic path detection
async function example3() {
  console.log('\n📝 Example 3: Automatic path detection');
  
  const uploader = new R2Uploader({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME
  });

  try {
    // When no destination path is provided, it uses the relative path from project root
    const publicUrl = await uploader.uploadFile('./stories/assets/example.png');
    console.log('File uploaded to:', publicUrl);
    // This would be uploaded as 'stories/assets/example.png' in the R2 bucket
  } catch (error) {
    console.error('Upload failed:', error.message);
  }
}

// Uncomment to run examples (make sure to configure your credentials first)
// example1();
// example2();
// example3();

module.exports = {
  example1,
  example2,
  example3
};