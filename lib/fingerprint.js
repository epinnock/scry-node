const crypto = require('crypto');

/**
 * @typedef {Object} Story
 * @property {string} [id] - Story ID (e.g., 'button--primary')
 * @property {string} [storyId] - Alternative story ID field
 * @property {string} [name] - Story name (e.g., 'Primary')
 * @property {string} [storyName] - Alternative story name field
 * @property {string} [componentPath] - Path to the component file
 * @property {string} [filePath] - Alternative path field
 */

/**
 * Generate a stable fingerprint for a story.
 *
 * The fingerprint is based on:
 * 1. Component file path (relative to project root)
 * 2. Story ID
 * 3. Story name/title
 *
 * This ensures the fingerprint is stable across builds even if:
 * - Story ordering changes
 * - Other story metadata changes
 * - The story is moved to a different position in the file
 *
 * @param {Story} story - The story object to fingerprint
 * @returns {string} - A 16-character hex fingerprint (64 bits)
 */
function generateStoryFingerprint(story) {
  if (!story || typeof story !== 'object') {
    return '';
  }

  // Extract the key identifying fields
  const componentPath = story.componentPath || story.filePath || '';
  const storyId = story.storyId || story.id || '';
  const storyName = story.storyName || story.name || '';

  // Create a stable input string
  // Using '::' as delimiter to avoid collisions
  const input = [componentPath, storyId, storyName].join('::');

  // If we have no identifying information, return empty string
  if (input === '::::') {
    return '';
  }

  // If storyId is missing, avoid generating fingerprint to reduce collisions
  if (!storyId) {
    return '';
  }

  // Generate SHA-256 hash and take first 16 characters (64 bits)
  // This provides sufficient uniqueness while keeping fingerprints readable
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Add fingerprints to all stories in a coverage report.
 *
 * This function is non-destructive - it creates a new report object
 * with fingerprints added to each story.
 *
 * @param {any} report - The coverage report to enhance
 * @returns {any} - The enhanced report with fingerprints, or original if invalid
 */
function addFingerprintsToReport(report) {
  if (!report || typeof report !== 'object') {
    return report;
  }

  const fingerprintStories = (stories) => {
    if (!Array.isArray(stories)) {
      return stories;
    }

    return stories.map((story) => {
      if (!story || typeof story !== 'object') {
        return story;
      }

      // Preserve existing fingerprints from scry-sbcov
      if (story.fingerprint) {
        return story;
      }

      const fingerprint = generateStoryFingerprint(story);

      // Only add fingerprint if we could generate one
      if (!fingerprint) {
        return story;
      }

      return {
        ...story,
        fingerprint,
      };
    });
  };

  const fingerprintedStories = fingerprintStories(report.stories);
  const fingerprintedExecutionStories = fingerprintStories(report.execution?.stories);

  const execution = report.execution
    ? {
        ...report.execution,
        stories: fingerprintedExecutionStories || report.execution.stories,
      }
    : report.execution;

  const nextReport = {
    ...report,
  };

  if (fingerprintedStories) {
    nextReport.stories = fingerprintedStories;
  }

  if (report.execution && fingerprintedExecutionStories) {
    nextReport.execution = execution;
  }

  return nextReport;
}

/**
 * Extract fingerprints from a report as a Set for quick lookup.
 *
 * @param {any} report - The coverage report
 * @returns {Set<string>} - Set of fingerprints
 */
function extractFingerprints(report) {
  const fingerprints = new Set();

  if (!report || !Array.isArray(report.stories)) {
    return fingerprints;
  }

  for (const story of report.stories) {
    if (story && story.fingerprint) {
      fingerprints.add(story.fingerprint);
    }
  }

  return fingerprints;
}

/**
 * Create a map of fingerprint to story for quick lookup.
 *
 * @param {any} report - The coverage report
 * @returns {Map<string, any>} - Map of fingerprint to story object
 */
function createFingerprintMap(report) {
  const map = new Map();

  if (!report || !Array.isArray(report.stories)) {
    return map;
  }

  for (const story of report.stories) {
    if (story && story.fingerprint) {
      map.set(story.fingerprint, story);
    }
  }

  return map;
}

/**
 * Check if a story is failing based on its status.
 *
 * @param {any} story - The story object
 * @returns {boolean} - True if the story is failing
 */
function isStoryFailing(story) {
  if (!story || typeof story !== 'object') {
    return false;
  }

  // Check various status field names that might indicate failure
  const status = story.status || story.state || story.result;

  if (typeof status === 'string') {
    const lowerStatus = status.toLowerCase();
    return (
      lowerStatus === 'failing' ||
      lowerStatus === 'failed' ||
      lowerStatus === 'error' ||
      lowerStatus === 'broken'
    );
  }

  // Check boolean fields
  if (typeof story.passing === 'boolean') {
    return !story.passing;
  }

  if (typeof story.failed === 'boolean') {
    return story.failed;
  }

  if (typeof story.error === 'boolean') {
    return story.error;
  }

  return false;
}

/**
 * Get failing story fingerprints from a report.
 *
 * @param {any} report - The coverage report
 * @returns {Set<string>} - Set of fingerprints for failing stories
 */
function getFailingFingerprints(report) {
  const failing = new Set();

  if (!report || !Array.isArray(report.stories)) {
    return failing;
  }

  for (const story of report.stories) {
    if (story && story.fingerprint && isStoryFailing(story)) {
      failing.add(story.fingerprint);
    }
  }

  return failing;
}

module.exports = {
  generateStoryFingerprint,
  addFingerprintsToReport,
  extractFingerprints,
  createFingerprintMap,
  isStoryFailing,
  getFailingFingerprints,
};
