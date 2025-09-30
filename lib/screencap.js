const { execSync } = require('child_process');

/**
 * Captures screenshots from a Storybook URL using storycap
 * @param {string} storybookUrl - URL of the deployed Storybook
 * @param {Object} options - Storycap options
 * @param {string} options.chromiumPath - Path to Chromium executable (optional)
 * @param {string} options.outDir - Output directory for screenshots (default: ./__screenshots__)
 * @param {number} options.parallel - Number of parallel browser instances (optional)
 * @param {number} options.delay - Delay between screenshots in ms (optional)
 * @param {string} options.include - Include stories matching pattern (optional)
 * @param {string} options.exclude - Exclude stories matching pattern (optional)
 * @param {boolean} options.omitBackground - Omit background (default: true)
 * @returns {Promise<void>}
 */
async function captureScreenshots(storybookUrl, options = {}) {
  // Build storycap command
  let command = `npx storycap "${storybookUrl}"`;
  
  if (options.chromiumPath) {
    command += ` --chromiumPath "${options.chromiumPath}"`;
  }
  
  if (options.omitBackground !== false) {
    command += ` --omitBackground true`;
  }
  
  if (options.outDir) {
    command += ` --outDir "${options.outDir}"`;
  }
  
  if (options.parallel) {
    command += ` --parallel ${options.parallel}`;
  }
  
  if (options.delay) {
    command += ` --delay ${options.delay}`;
  }
  
  if (options.include) {
    command += ` --include "${options.include}"`;
  }
  
  if (options.exclude) {
    command += ` --exclude "${options.exclude}"`;
  }
  
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    throw new Error(`Failed to capture screenshots: ${error.message}`);
  }
}

module.exports = { captureScreenshots };