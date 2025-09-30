const fs = require('fs');
const path = require('path');
const { crawlStories } = require('./crawl-stories.cjs');

/**
 * Converts camelCase story names to space-separated screenshot names
 * @param {string} storyName - The camelCase story name
 * @returns {string} Space-separated name for screenshot
 */
function convertStoryNameToScreenshotName(storyName) {
  // Convert camelCase to space-separated (e.g., "LoggedIn" -> "Logged In")
  return storyName.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Extracts the title from story file content
 * @param {string} filePath - Path to the story file
 * @returns {string|null} The title from the meta object
 */
function extractStoryTitle(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
    return titleMatch ? titleMatch[1] : null;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Recursively finds all screenshot files in the __screenshots__ directory
 * @param {string} screenshotsDir - Path to screenshots directory
 * @param {string[]} fileList - Accumulator for found files
 * @returns {string[]} Array of screenshot file paths
 */
function findScreenshotFiles(screenshotsDir, fileList = []) {
  if (!fs.existsSync(screenshotsDir)) {
    return fileList;
  }

  const files = fs.readdirSync(screenshotsDir);
  
  files.forEach(file => {
    const filePath = path.join(screenshotsDir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findScreenshotFiles(filePath, fileList);
    } else if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

/**
 * Maps a story entry to its corresponding screenshot
 * @param {Object} storyEntry - Story entry from crawl-stories
 * @param {string} storyTitle - The title from the story meta object
 * @param {string[]} screenshotFiles - Array of all screenshot file paths
 * @returns {string|null} Path to the corresponding screenshot
 */
function findMatchingScreenshot(storyEntry, storyTitle, screenshotFiles) {
  const screenshotName = convertStoryNameToScreenshotName(storyEntry.testName);
  
  // Build expected screenshot path
  const expectedPath = path.join('__screenshots__', storyTitle, `${screenshotName}.png`);
  
  // Try to find exact match
  let matchingScreenshot = screenshotFiles.find(filePath => 
    path.normalize(filePath) === path.normalize(expectedPath)
  );
  
  // If no exact match, try case-insensitive search
  if (!matchingScreenshot) {
    matchingScreenshot = screenshotFiles.find(filePath => {
      const normalizedPath = path.normalize(filePath).toLowerCase();
      const normalizedExpected = path.normalize(expectedPath).toLowerCase();
      return normalizedPath === normalizedExpected;
    });
  }
  
  // If still no match, try partial matching on filename only
  if (!matchingScreenshot) {
    const screenshotFileName = `${screenshotName}.png`.toLowerCase();
    matchingScreenshot = screenshotFiles.find(filePath => {
      const fileName = path.basename(filePath).toLowerCase();
      return fileName === screenshotFileName;
    });
  }
  
  return matchingScreenshot || null;
}

/**
 * Main function to map stories to their screenshots
 * @param {string} storiesDir - Directory containing stories
 * @param {string} screenshotsDir - Directory containing screenshots
 * @returns {Array} Array of story entries with screenshot paths
 */
function mapStoriesToScreenshots(storiesDir = './stories', screenshotsDir = './__screenshots__') {
  // Get all story entries
  const storyEntries = crawlStories(storiesDir);
  
  // Get all screenshot files
  const screenshotFiles = findScreenshotFiles(screenshotsDir);
  
  // Map each story to its screenshot
  const mappedEntries = storyEntries.map(storyEntry => {
    // Extract title from the story file
    const storyTitle = extractStoryTitle(storyEntry.filepath);
    
    // Find matching screenshot
    const screenshotPath = findMatchingScreenshot(storyEntry, storyTitle, screenshotFiles);
    
    return {
      ...storyEntry,
      storyTitle: storyTitle,
      screenshotPath: screenshotPath
    };
  });
  
  return mappedEntries;
}

/**
 * Groups the mapped entries by component for better organization
 * @param {Array} mappedEntries - Array of mapped story entries
 * @returns {Object} Grouped entries by component
 */
function groupByComponent(mappedEntries) {
  return mappedEntries.reduce((groups, entry) => {
    const componentName = entry.componentName;
    if (!groups[componentName]) {
      groups[componentName] = [];
    }
    groups[componentName].push(entry);
    return groups;
  }, {});
}

// If running as a script, execute the mapper
if (require.main === module) {
  const args = process.argv.slice(2);
  const groupByComp = args.includes('--group');
  
  // Filter out flags to get positional arguments
  const positionalArgs = args.filter(arg => !arg.startsWith('--'));
  const storiesDir = positionalArgs[0] || './stories';
  const screenshotsDir = positionalArgs[1] || './__screenshots__';
  
  const mappedEntries = mapStoriesToScreenshots(storiesDir, screenshotsDir);
  
  if (groupByComp) {
    const grouped = groupByComponent(mappedEntries);
    console.log(JSON.stringify(grouped, null, 2));
  } else {
    console.log(JSON.stringify(mappedEntries, null, 2));
  }
}

module.exports = { 
  mapStoriesToScreenshots, 
  findScreenshotFiles, 
  convertStoryNameToScreenshotName,
  extractStoryTitle,
  findMatchingScreenshot,
  groupByComponent
};