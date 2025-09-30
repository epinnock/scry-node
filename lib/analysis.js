const fs = require('fs');
const path = require('path');

/**
 * Recursively finds all .stories.ts and .stories.tsx files in a directory
 * @param {string} dir - Directory to search
 * @param {string[]} fileList - Accumulator for found files
 * @returns {string[]} Array of story file paths
 */
function findStoryFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findStoryFiles(filePath, fileList);
    } else if (file.endsWith('.stories.ts') || file.endsWith('.stories.tsx')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

/**
 * Extracts component name from import statements or meta object
 * @param {string} content - File content
 * @returns {string|null} Component name
 */
function extractComponentName(content) {
  // Try to find component from import statement
  const importMatch = content.match(/import\s+{\s*([^}]+)\s*}\s+from\s+['"]\.\/([^'"]+)['"]/);
  if (importMatch) {
    const importedNames = importMatch[1].split(',').map(name => name.trim());
    // Find the component (usually the one that starts with uppercase)
    const componentName = importedNames.find(name => /^[A-Z]/.test(name));
    if (componentName) return componentName;
  }
  
  // Try to find component from meta.component
  const metaMatch = content.match(/component:\s*([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (metaMatch) {
    return metaMatch[1];
  }
  
  return null;
}

/**
 * Extracts the title from story file content
 * @param {string} content - File content
 * @returns {string|null} The title from the meta object
 */
function extractStoryTitle(content) {
  const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
  return titleMatch ? titleMatch[1] : null;
}

/**
 * Extracts story exports and their line numbers from file content
 * @param {string} content - File content
 * @returns {Array} Array of story objects with name and location
 */
function extractStories(content) {
  const lines = content.split('\n');
  const stories = [];
  
  // Look for export statements that define stories
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    
    // Match export const/let/var StoryName: Story = {
    const exportMatch = line.match(/^export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*Story\s*=/);
    if (exportMatch) {
      const storyName = exportMatch[1];
      
      // Find the end of this story object
      let endLine = lineNumber;
      let braceCount = 0;
      let inStory = false;
      
      for (let i = index; i < lines.length; i++) {
        const currentLine = lines[i];
        
        // Count opening and closing braces
        for (const char of currentLine) {
          if (char === '{') {
            braceCount++;
            inStory = true;
          } else if (char === '}') {
            braceCount--;
          }
        }
        
        // If we've closed all braces and we were in a story, we found the end
        if (inStory && braceCount === 0) {
          endLine = i + 1;
          break;
        }
      }
      
      stories.push({
        testName: storyName,
        location: {
          startLine: lineNumber,
          endLine: endLine
        }
      });
    }
  });
  
  return stories;
}

/**
 * Processes a single story file and extracts information
 * @param {string} filePath - Path to the story file
 * @returns {Object|null} Story file information
 */
function processStoryFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const componentName = extractComponentName(content);
    const storyTitle = extractStoryTitle(content);
    const stories = extractStories(content);
    
    if (!componentName || stories.length === 0) {
      return null;
    }
    
    return {
      filepath: filePath,
      componentName: componentName,
      storyTitle: storyTitle,
      stories: stories
    };
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Main function to crawl all story files and return results
 * @param {string} storiesDir - Directory containing stories
 * @returns {Array} Array of story file information
 */
function crawlStories(storiesDir = './stories') {
  const storyFiles = findStoryFiles(storiesDir);
  const results = [];
  
  storyFiles.forEach(filePath => {
    const fileInfo = processStoryFile(filePath);
    if (fileInfo) {
      // Flatten the structure to match the requested format
      fileInfo.stories.forEach(story => {
        results.push({
          filepath: fileInfo.filepath,
          componentName: fileInfo.componentName,
          storyTitle: fileInfo.storyTitle,
          testName: story.testName,
          location: story.location
        });
      });
    }
  });
  
  return results;
}

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
    // Find matching screenshot
    const screenshotPath = findMatchingScreenshot(storyEntry, storyEntry.storyTitle, screenshotFiles);
    
    return {
      ...storyEntry,
      screenshotPath: screenshotPath
    };
  });
  
  return mappedEntries;
}

/**
 * Analyzes storybook stories and maps them to screenshots
 * @param {Object} config - Configuration options
 * @param {string} config.storiesDir - Directory containing stories
 * @param {string} config.screenshotsDir - Directory containing screenshots
 * @param {string} config.project - Project name
 * @param {string} config.version - Version identifier
 * @returns {Object} Analysis results with metadata
 */
function analyzeStorybook(config) {
  const {
    storiesDir = './stories',
    screenshotsDir = './__screenshots__',
    project,
    version
  } = config;
  
  // Map stories to screenshots
  const stories = mapStoriesToScreenshots(storiesDir, screenshotsDir);
  
  // Calculate summary statistics
  const totalStories = stories.length;
  const withScreenshots = stories.filter(s => s.screenshotPath).length;
  
  return {
    project: project || 'unknown',
    version: version || 'unknown',
    timestamp: new Date().toISOString(),
    summary: {
      totalStories,
      withScreenshots
    },
    stories
  };
}

module.exports = {
  findStoryFiles,
  extractComponentName,
  extractStoryTitle,
  extractStories,
  processStoryFile,
  crawlStories,
  convertStoryNameToScreenshotName,
  findScreenshotFiles,
  findMatchingScreenshot,
  mapStoriesToScreenshots,
  analyzeStorybook
};