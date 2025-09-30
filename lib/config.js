const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Default configuration for storybook-deployer
 */
const DEFAULT_CONFIG = {
  apiUrl: 'https://api.default-service.com/v1',
  verbose: false,
  // Users should set these values
  apiKey: '',
  dir: './storybook-static',
  // Project and version for deployment
  project: '',
  version: ''
};

/**
 * Get the config file path in the project directory
 */
function getConfigPath() {
  return path.join(process.cwd(), '.storybook-deployer.json');
}

/**
 * Create a default config file if it doesn't exist
 */
function createDefaultConfig() {
  const configPath = getConfigPath();
  
  if (!fs.existsSync(configPath)) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
      console.log(`✅ Created config file at: ${configPath}`);
      console.log('📝 Please edit this file to set your API key and other preferences.');
    } catch (error) {
      console.warn(`⚠️  Could not create config file at ${configPath}: ${error.message}`);
    }
  } else {
    console.log(`📁 Config file already exists at: ${configPath}`);
  }
}

/**
 * Load environment variables with STORYBOOK_DEPLOYER_ prefix
 */
function loadEnvConfig() {
  const envConfig = {};
  const prefix = 'STORYBOOK_DEPLOYER_';
  
  // Map environment variable names to config keys
  const envMapping = {
    'API_URL': 'apiUrl',
    'VERBOSE': 'verbose',
    'API_KEY': 'apiKey',
    'DIR': 'dir',
    'PROJECT': 'project',
    'VERSION': 'version'
  };
  
  Object.keys(envMapping).forEach(envKey => {
    const fullEnvKey = prefix + envKey;
    const configKey = envMapping[envKey];
    const envValue = process.env[fullEnvKey];
    
    if (envValue !== undefined) {
      // Convert string values to appropriate types
      if (configKey === 'verbose') {
        envConfig[configKey] = envValue.toLowerCase() === 'true';
      } else {
        envConfig[configKey] = envValue;
      }
    }
  });
  
  return envConfig;
}

/**
 * Load configuration from file, merging with provided options
 */
function loadConfig(cliArgs = {}) {
  const configPath = getConfigPath();
  let fileConfig = {};
  
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      fileConfig = JSON.parse(configContent);
    } catch (error) {
      console.warn(`⚠️  Could not read config file at ${configPath}: ${error.message}`);
    }
  }
  
  // Load environment variables
  const envConfig = loadEnvConfig();
  
  // Precedence: CLI arguments > environment variables > file config > defaults
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...cliArgs
  };
}

/**
 * Get the path to the config file (for user reference)
 */
function getConfigFilePath() {
  return getConfigPath();
}

module.exports = {
  createDefaultConfig,
  loadConfig,
  getConfigFilePath,
  DEFAULT_CONFIG
};