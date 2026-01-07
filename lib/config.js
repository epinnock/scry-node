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
  version: '',
  // Analysis options
  withAnalysis: false,
  storiesDir: null, // null enables auto-detection of .stories.* files
  screenshotsDir: './__screenshots__',
  storybookUrl: '',
  storycapOptions: {
    chromiumPath: '',
    outDir: './__screenshots__',
    parallel: undefined,
    delay: undefined,
    include: undefined,
    exclude: undefined,
    omitBackground: true
  },
  // Coverage options (enabled by default)
  coverage: true,
  coverageReport: null,
  coverageFailOnThreshold: false,
  coverageBase: 'main'
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
 * Detect if running in GitHub Actions and extract version information
 */
function detectGitHubActionsContext() {
  // Only detect if running in GitHub Actions environment
  if (!process.env.GITHUB_ACTIONS) {
    return {};
  }

  const context = {};

  // Detect version based on GitHub event type
  const eventName = process.env.GITHUB_EVENT_NAME;
  const ref = process.env.GITHUB_REF; // e.g., refs/pull/17/merge, refs/heads/main

  if (eventName === 'pull_request' && ref) {
    // Extract PR number from ref like "refs/pull/17/merge"
    const prMatch = ref.match(/refs\/pull\/(\d+)\//);
    if (prMatch && prMatch[1]) {
      context.version = `pr-${prMatch[1]}`;
    }
  } else if (ref) {
    // For other events, extract branch name
    if (ref.startsWith('refs/heads/')) {
      const branch = ref.replace('refs/heads/', '');
      // Use branch name, sanitize it for URL safety
      context.version = branch.replace(/[^a-zA-Z0-9-_]/g, '-');
    } else if (ref.startsWith('refs/tags/')) {
      const tag = ref.replace('refs/tags/', '');
      context.version = tag.replace(/[^a-zA-Z0-9-_.]/g, '-');
    }
  }

  // If we couldn't determine version from ref, use commit SHA
  if (!context.version && process.env.GITHUB_SHA) {
    context.version = process.env.GITHUB_SHA.substring(0, 7);
  }

  return context;
}

/**
 * Load environment variables with SCRY_ or STORYBOOK_DEPLOYER_ prefix
 */
function loadEnvConfig() {
  const envConfig = {};

  // Map environment variable names to config keys
  const envMapping = {
    'API_URL': 'apiUrl',
    'VERBOSE': 'verbose',
    'API_KEY': 'apiKey',
    'DIR': 'dir',
    'PROJECT': 'project',
    'VERSION': 'version',
    'WITH_ANALYSIS': 'withAnalysis',
    'STORIES_DIR': 'storiesDir',
    'SCREENSHOTS_DIR': 'screenshotsDir',
    'STORYBOOK_URL': 'storybookUrl'
  };

  Object.keys(envMapping).forEach(envKey => {
    const configKey = envMapping[envKey];

    // Check SCRY_ prefix first (new standard), then fall back to STORYBOOK_DEPLOYER_ for backward compatibility
    const scryEnvKey = 'SCRY_' + envKey;
    const legacyEnvKey = 'STORYBOOK_DEPLOYER_' + envKey;

    // Handle special case for PROJECT_ID vs PROJECT
    let envValue = process.env[scryEnvKey];
    if (!envValue && envKey === 'PROJECT') {
      envValue = process.env['SCRY_PROJECT_ID'];
    }
    if (!envValue) {
      envValue = process.env[legacyEnvKey];
    }

    // Filter out undefined and empty string values to prevent overriding CLI args
    if (envValue !== undefined && envValue !== '') {
      // Convert string values to appropriate types
      if (configKey === 'verbose' || configKey === 'withAnalysis') {
        envConfig[configKey] = envValue.toLowerCase() === 'true';
      } else {
        envConfig[configKey] = envValue;
      }
    }
  });

  // Coverage env vars (spec names)
  if (process.env.SCRY_COVERAGE_ENABLED !== undefined && process.env.SCRY_COVERAGE_ENABLED !== '') {
    envConfig.coverage = process.env.SCRY_COVERAGE_ENABLED.toLowerCase() !== 'false';
  }

  if (process.env.SCRY_COVERAGE_REPORT !== undefined && process.env.SCRY_COVERAGE_REPORT !== '') {
    envConfig.coverageReport = process.env.SCRY_COVERAGE_REPORT;
  }

  if (
    process.env.SCRY_COVERAGE_FAIL_ON_THRESHOLD !== undefined &&
    process.env.SCRY_COVERAGE_FAIL_ON_THRESHOLD !== ''
  ) {
    envConfig.coverageFailOnThreshold = process.env.SCRY_COVERAGE_FAIL_ON_THRESHOLD.toLowerCase() === 'true';
  }

  if (process.env.SCRY_COVERAGE_BASE !== undefined && process.env.SCRY_COVERAGE_BASE !== '') {
    envConfig.coverageBase = process.env.SCRY_COVERAGE_BASE;
  }

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

  // Detect GitHub Actions context
  const githubContext = detectGitHubActionsContext();

  // Precedence: CLI arguments > GitHub Actions context > environment variables > file config > defaults
  // This ensures GitHub Actions auto-detection works even if env vars are set to empty strings

  // Map 'deployVersion' (from yargs --deploy-version) to 'version' for internal use
  const normalizedCliArgs = { ...cliArgs };
  if (normalizedCliArgs.deployVersion) {
    normalizedCliArgs.version = normalizedCliArgs.deployVersion;
    delete normalizedCliArgs.deployVersion;
  }

  const finalConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...githubContext,
    ...normalizedCliArgs
  };

  const debugConfig = Boolean(finalConfig.verbose);
  if (debugConfig) {
    // Log configuration sources for debugging
    console.log('[CONFIG] Configuration sources:');
    console.log(`[CONFIG] - Default apiUrl: ${DEFAULT_CONFIG.apiUrl}`);
    console.log(`[CONFIG] - File config apiUrl: ${fileConfig.apiUrl || 'not set'}`);
    console.log(`[CONFIG] - Env SCRY_API_URL: ${process.env.SCRY_API_URL || 'not set'}`);
    console.log(`[CONFIG] - Env STORYBOOK_DEPLOYER_API_URL: ${process.env.STORYBOOK_DEPLOYER_API_URL || 'not set'}`);
    console.log(`[CONFIG] - CLI args apiUrl: ${cliArgs.apiUrl || 'not set'}`);
    console.log(`[CONFIG] Final apiUrl: ${finalConfig.apiUrl}`);
    console.log(`[CONFIG] Final project: ${finalConfig.project}`);
    console.log(`[CONFIG] Final version: ${finalConfig.version}`);
    console.log(`[CONFIG] Final coverage: ${finalConfig.coverage}`);
  }

  return finalConfig;
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