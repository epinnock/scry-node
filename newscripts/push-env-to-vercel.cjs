#!/usr/bin/env node

/**
 * Script to push environment variables from a file to Vercel
 */

const fs = require('fs');
const { spawn } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
let envFile = '.env.local';
let vercelEnvironment = 'production';
let showHelp = false;

// Simple argument parser
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--help' || arg === '-h') {
    showHelp = true;
  } else if (arg === '--file' || arg === '-f') {
    envFile = args[i + 1];
    i++; // Skip next argument
  } else if (arg === '--environment' || arg === '-e') {
    vercelEnvironment = args[i + 1];
    i++; // Skip next argument
  } else if (!arg.startsWith('-')) {
    // Positional arguments
    if (!envFile || envFile === '.env.local') {
      envFile = arg;
    } else if (!vercelEnvironment || vercelEnvironment === 'production') {
      vercelEnvironment = arg;
    }
  }
}

// Display help if requested
if (showHelp) {
  console.log(`
Usage: node push-env-to-vercel.js [options] [envFile] [environment]

Push environment variables from a file to Vercel

Arguments:
  envFile                    Path to environment file (default: .env.local)
  environment                Vercel environment (production, preview, development) (default: production)

Options:
  -f, --file <path>          Specify environment file path
  -e, --environment <env>    Specify Vercel environment (production, preview, development)
  -h, --help                 Display this help message

Examples:
  node push-env-to-vercel.js
  node push-env-to-vercel.js .env.production
  node push-env-to-vercel.js .env.local development
  node push-env-to-vercel.js -f .env.staging -e preview
  node push-env-to-vercel.js --file .env.dev --environment development
  `);
  process.exit(0);
}

// Validate environment
const validEnvironments = ['production', 'preview', 'development'];
if (!validEnvironments.includes(vercelEnvironment)) {
  console.error(`Error: Invalid environment '${vercelEnvironment}'. Must be one of: ${validEnvironments.join(', ')}`);
  process.exit(1);
}

// Check if the file exists
if (!fs.existsSync(envFile)) {
  console.error(`Error: File '${envFile}' not found.`);
  process.exit(1);
}

console.log(`Reading environment variables from ${envFile}...`);
console.log(`Setting variables for ${vercelEnvironment} environment...\n`);

// Read the file line by line
const lines = fs.readFileSync(envFile, 'utf-8').split('\n');

// Filter out empty lines and comments
const validLines = lines.filter(line => {
  return line.trim() !== '' && !line.trim().startsWith('#');
});

console.log(`Processing ${validLines.length} environment variables...\n`);

// Process variables sequentially
async function processVariables() {
  let successCount = 0;
  
  for (const line of validLines) {
    // Parse key-value pair
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }

      // Skip if key is empty
      if (key === '') {
        continue;
      }

      console.log(`Setting ${key}=...`);

      try {
        await new Promise((resolve, reject) => {
          // Execute vercel env add command
          const vercel = spawn('vercel', ['env', 'add', key, vercelEnvironment], {
            stdio: ['pipe', 'inherit', 'inherit']
          });

          vercel.stdin.write(value);
          vercel.stdin.end();

          vercel.on('close', (code) => {
            if (code === 0) {
              successCount++;
              console.log(`Successfully set ${key} for ${vercelEnvironment} environment\n`);
              resolve();
            } else {
              console.error(`Failed to set ${key} for ${vercelEnvironment} environment`);
              resolve(); // Continue with next variable even if this one fails
            }
          });

          vercel.on('error', (error) => {
            console.error(`Error setting ${key}:`, error.message);
            resolve(); // Continue with next variable even if this one fails
          });
        });
      } catch (error) {
        console.error(`Error processing ${key}:`, error.message);
      }
    }
  }
  
  console.log(`\nCompleted! Successfully set ${successCount} environment variables.`);
}

processVariables();