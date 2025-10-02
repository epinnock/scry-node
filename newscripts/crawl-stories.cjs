const fs = require('fs');
const path = require('path');

// Directories to exclude from story file search
const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  '__screenshots__',
  '.storybook',
  'public',
  'static'
];

/**
 * Checks if a file matches the story file pattern (.stories.*)
 * @param {string} filename - Filename to check
 * @returns {boolean} True if file is a story file
 */
function isStoryFile(filename) {
  return /\.stories\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(filename);
}

/**
 * Auto-detects the stories directory by searching for .stories.* files
 * @param {string} searchRoot - Root directory to search from (default: current directory)
 * @param {number} maxDepth - Maximum depth to search (default: 5)
 * @returns {string|null} Path to detected stories directory or null
 */
function autoDetectStoriesDir(searchRoot = '.', maxDepth = 5) {
  const storyFiles = [];
  
  function searchDir(dir, depth = 0) {
    if (depth > maxDepth) return;
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip excluded directories
          if (!EXCLUDED_DIRS.includes(entry.name)) {
            searchDir(fullPath, depth + 1);
          }
        } else if (entry.isFile() && isStoryFile(entry.name)) {
          storyFiles.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  searchDir(searchRoot);
  
  if (storyFiles.length === 0) return null;
  
  // Find common parent directory of all story files
  const dirs = storyFiles.map(file => path.dirname(file));
  const uniqueDirs = [...new Set(dirs)];
  
  if (uniqueDirs.length === 1) {
    return uniqueDirs[0];
  }
  
  // Find the most common parent directory
  const commonPath = uniqueDirs.reduce((acc, dir) => {
    if (!acc) return dir;
    const accParts = acc.split(path.sep);
    const dirParts = dir.split(path.sep);
    const common = [];
    for (let i = 0; i < Math.min(accParts.length, dirParts.length); i++) {
      if (accParts[i] === dirParts[i]) {
        common.push(accParts[i]);
      } else {
        break;
      }
    }
    return common.join(path.sep) || '.';
  });
  
  return commonPath || '.';
}

/**
 * Recursively finds all story files matching .stories.* pattern
 * @param {string} dir - Directory to search
 * @param {string[]} fileList - Accumulator for found files
 * @returns {string[]} Array of story file paths
 */
function findStoryFiles(dir, fileList = []) {
  // If dir is null/undefined, try auto-detection
  if (!dir || !fs.existsSync(dir)) {
    console.log(`📂 Auto-detecting stories directory...`);
    dir = autoDetectStoriesDir();
    if (!dir) {
      console.warn(`⚠️  No story files found in project`);
      return [];
    }
    console.log(`✅ Found stories in: ${dir}`);
  }

  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip excluded directories
      if (!EXCLUDED_DIRS.includes(file)) {
        findStoryFiles(filePath, fileList);
      }
    } else if (isStoryFile(file)) {
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
    const stories = extractStories(content);
    
    if (!componentName || stories.length === 0) {
      return null;
    }
    
    return {
      filepath: filePath,
      componentName: componentName,
      stories: stories
    };
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Main function to crawl all story files and return results
 * @param {string} storiesDir - Directory containing stories (optional, will auto-detect if not provided)
 * @returns {Array} Array of story file information
 */
function crawlStories(storiesDir = null) {
  let storyFiles;
  
  // If no directory provided or directory doesn't exist, try auto-detection
  if (!storiesDir || !fs.existsSync(storiesDir)) {
    if (storiesDir && !fs.existsSync(storiesDir)) {
      console.warn(`⚠️  Specified directory '${storiesDir}' not found. Attempting auto-detection...`);
    }
    storyFiles = findStoryFiles(null);
  } else {
    storyFiles = findStoryFiles(storiesDir);
  }
  
  if (storyFiles.length === 0) {
    console.warn(`⚠️  No story files found`);
    return [];
  }
  
  console.log(`📚 Found ${storyFiles.length} story file(s)`);
  
  const results = [];
  
  storyFiles.forEach(filePath => {
    const fileInfo = processStoryFile(filePath);
    if (fileInfo) {
      // Flatten the structure to match the requested format
      fileInfo.stories.forEach(story => {
        results.push({
          filepath: fileInfo.filepath,
          componentName: fileInfo.componentName,
          testName: story.testName,
          location: story.location
        });
      });
    }
  });
  
  return results;
}

// If running as a script, execute the crawler
if (require.main === module) {
  const storiesDir = process.argv[2] || null; // null will trigger auto-detection
  const results = crawlStories(storiesDir);
  
  console.log(JSON.stringify(results, null, 2));
}

module.exports = { 
  crawlStories, 
  findStoryFiles, 
  extractComponentName, 
  extractStories, 
  processStoryFile,
  autoDetectStoriesDir,
  isStoryFile
};