const fs = require('fs');
const path = require('path');

/**
 * Recursively finds all .stories.ts files in a directory
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
  const storiesDir = process.argv[2] || './stories';
  const results = crawlStories(storiesDir);
  
  console.log(JSON.stringify(results, null, 2));
}

module.exports = { crawlStories, findStoryFiles, extractComponentName, extractStories, processStoryFile };