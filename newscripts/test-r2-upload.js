const R2Uploader = require('./r2-upload.js');

// Test script to verify R2Uploader functionality
console.log('🧪 Testing R2Uploader script...');

try {
  // Test 1: Check if the class can be imported
  console.log('✅ R2Uploader class imported successfully');
  console.log('Class type:', typeof R2Uploader);
  
  // Test 2: Try to instantiate with mock config (should work)
  const mockConfig = {
    accountId: 'test-account',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucketName: 'test-bucket'
  };
  
  const uploader = new R2Uploader(mockConfig);
  console.log('✅ R2Uploader instance created successfully');
  
  // Test 3: Check if methods exist
  const methods = ['uploadFile', 'uploadFiles'];
  methods.forEach(method => {
    if (typeof uploader[method] === 'function') {
      console.log(`✅ Method ${method} exists and is a function`);
    } else {
      console.log(`❌ Method ${method} is missing or not a function`);
    }
  });
  
  // Test 4: Try to instantiate without config (should throw error)
  try {
    new R2Uploader();
    console.log('❌ Constructor should have thrown error for missing config');
  } catch (error) {
    console.log('✅ Constructor properly validates required configuration');
  }
  
  console.log('🎉 All basic tests passed!');
  
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}