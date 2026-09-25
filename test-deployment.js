#!/usr/bin/env node

/**
 * Test script to verify storybook-deployer functionality
 * This helps isolate whether errors are from:
 * 1. The library code itself
 * 2. Local environment/credentials
 * 3. Backend service
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧪 Testing storybook-deployer functionality...\n');

// Step 1: Create a minimal storybook-static directory
console.log('📁 Step 1: Creating test storybook-static directory...');
const testDir = path.join(__dirname, 'test-storybook-static');

if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true });
}

fs.mkdirSync(testDir, { recursive: true });

// Create a minimal index.html
fs.writeFileSync(
  path.join(testDir, 'index.html'),
  `<!DOCTYPE html>
<html>
<head><title>Test Storybook</title></head>
<body><h1>Test Storybook Deployment</h1></body>
</html>`
);

console.log('✅ Created test directory with index.html\n');

// Step 2: Create a test config file
console.log('📝 Step 2: Creating test config file...');
const testConfigPath = path.join(__dirname, '.storybook-deployer-test.json');

const testConfig = {
  apiUrl: process.env.STORYBOOK_DEPLOYER_API_URL || "https://upload.scrymore.com",
  apiKey: process.env.STORYBOOK_DEPLOYER_API_KEY || "",
  dir: "./test-storybook-static",
  project: "test-project",
  version: "test-v1",
  verbose: true,
  withAnalysis: false
};

fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
console.log('✅ Created test config:', testConfigPath);
console.log('Config:', JSON.stringify(testConfig, null, 2), '\n');

// Step 3: Check required environment variables
console.log('🔍 Step 3: Checking environment variables...');
const requiredEnvVars = [
  'STORYBOOK_DEPLOYER_API_KEY'
];

let missingVars = [];
requiredEnvVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`✅ ${varName}: Set`);
  } else {
    console.log(`❌ ${varName}: Missing`);
    missingVars.push(varName);
  }
});

if (missingVars.length > 0) {
  console.log('\n⚠️  Warning: Missing environment variables:', missingVars.join(', '));
  console.log('You can set them in your .env file or pass them when running the test:\n');
  console.log('STORYBOOK_DEPLOYER_API_KEY=your_key node test-deployment.js\n');
}

// Step 4: Run the deployment
console.log('\n🚀 Step 4: Running deployment...\n');
console.log('═'.repeat(60));

try {
  // Try using the local binary
  const binPath = path.join(__dirname, 'bin', 'cli.js');
  
  console.log(`Executing: node ${binPath} --dir ${testConfig.dir} --project ${testConfig.project} --version ${testConfig.version} --verbose\n`);
  
  const result = execSync(
    `node "${binPath}" --dir "${testConfig.dir}" --project "${testConfig.project}" --version "${testConfig.version}" --verbose`,
    {
      encoding: 'utf8',
      stdio: 'inherit',
      env: {
        ...process.env,
        STORYBOOK_DEPLOYER_API_URL: testConfig.apiUrl,
        STORYBOOK_DEPLOYER_API_KEY: testConfig.apiKey || process.env.STORYBOOK_DEPLOYER_API_KEY
      }
    }
  );
  
  console.log('\n═'.repeat(60));
  console.log('\n✅ Deployment test completed successfully!\n');
  
} catch (error) {
  console.log('\n═'.repeat(60));
  console.log('\n❌ Deployment test failed!\n');
  
  // Analyze the error
  const errorMessage = error.message || error.toString();
  
  if (errorMessage.includes('Credential access key has length 39, should be 32')) {
    console.log('🔍 ERROR ANALYSIS:');
    console.log('━'.repeat(60));
    console.log('Issue: R2 credential length mismatch');
    console.log('Location: Backend service (Cloudflare Worker)');
    console.log('\nThe backend at:');
    console.log(`  ${testConfig.apiUrl}`);
    console.log('\nhas R2 credentials with incorrect format:');
    console.log('  - Access Key ID: 39 characters (should be 32 hex chars)');
    console.log('\n💡 SOLUTION:');
    console.log('The backend Cloudflare Worker needs new R2 credentials.');
    console.log('Steps to fix:');
    console.log('1. Go to Cloudflare Dashboard > R2 > Manage R2 API Tokens');
    console.log('2. Create new API token (Access Key will be 32 hex chars)');
    console.log('3. Update the Worker environment variables');
    console.log('━'.repeat(60));
    console.log('\n✅ This confirms the library code is working correctly.');
    console.log('❌ The backend service needs credential updates.\n');
    
  } else if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
    console.log('🔍 ERROR ANALYSIS:');
    console.log('━'.repeat(60));
    console.log('Issue: Authentication failed');
    console.log('Location: API Key validation');
    console.log('\n💡 SOLUTION:');
    console.log('Check your STORYBOOK_DEPLOYER_API_KEY environment variable');
    console.log('━'.repeat(60));
    
  } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
    console.log('🔍 ERROR ANALYSIS:');
    console.log('━'.repeat(60));
    console.log('Issue: Cannot reach backend service');
    console.log(`URL: ${testConfig.apiUrl}`);
    console.log('\n💡 SOLUTION:');
    console.log('1. Check if the backend service is running');
    console.log('2. Verify the API URL is correct');
    console.log('3. Check your internet connection');
    console.log('━'.repeat(60));
    
  } else {
    console.log('🔍 ERROR ANALYSIS:');
    console.log('━'.repeat(60));
    console.log('Full error:', error);
    console.log('━'.repeat(60));
  }
  
  process.exit(1);
}

// Cleanup
console.log('🧹 Cleaning up test files...');
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true });
}
if (fs.existsSync(testConfigPath)) {
  fs.unlinkSync(testConfigPath);
}
console.log('✅ Cleanup complete\n');