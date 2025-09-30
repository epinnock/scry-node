const { execSync } = require('child_process');

/**
 * Retrieves the current Git commit ID (full SHA hash).
 * 
 * @returns {string} The full commit hash as a string
 * @throws {Error} When not in a Git repository, Git is not available, or command fails
 * 
 * @example
 * const { getCurrentCommitId } = require('./git-utils.cjs');
 * const commitId = getCurrentCommitId(); // Returns: "a1b2c3d4e5f6..."
 */
function getCurrentCommitId() {
  try {
    // Execute git rev-parse HEAD to get the current commit hash
    const commitId = execSync('git rev-parse HEAD', { 
      encoding: 'utf8',
      // Suppress stderr to handle errors gracefully
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    
    return commitId;
  } catch (error) {
    // Handle various Git-related errors
    if (error.code === 'ENOENT') {
      throw new Error('Git is not installed or not available in PATH');
    }
    
    if (error.status === 128) {
      throw new Error('Not in a Git repository or Git repository is corrupted');
    }
    
    if (error.stderr && error.stderr.includes('not a git repository')) {
      throw new Error('Current directory is not a Git repository');
    }
    
    // Generic error for other cases
    throw new Error(`Failed to retrieve Git commit ID: ${error.message}`);
  }
}

module.exports = {
  getCurrentCommitId
};