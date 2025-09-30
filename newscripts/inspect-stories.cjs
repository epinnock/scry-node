const fs = require('fs');
const { inspectComponent, batchInspectMultipleComponents } = require('./inspect-component.cjs');

/**
 * Processes story objects with screenshot paths in batches
 * @param {Array} stories - Array of story objects with screenshotPath
 * @param {string} apiKey - OpenAI API key
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} Promise that resolves to analysis results
 */
async function processStoriesInBatches(stories, apiKey, options = {}) {
  const {
    batchSize = 5,
    delayBetweenBatches = 100, // 100ms between batches
    delayBetweenRequests = 0, // Only used for fallback individual processing
    model = 'gpt-5-mini',
    maxTokens = 1500,
    temperature = 0.1,
    continueOnError = true,
    useBatchAPI = true, // New option to enable/disable batch processing
    fallbackToIndividual = true // Enable automatic fallback
  } = options;

  const results = [];
  const errors = [];

  // Filter stories that have screenshot paths
  const storiesWithScreenshots = stories.filter(story =>
    story.screenshotPath && fs.existsSync(story.screenshotPath)
  );
  
  if (storiesWithScreenshots.length === 0) {
    console.log('No stories with valid screenshot paths found.');
    return [];
  }

  console.log(`📸 Processing ${storiesWithScreenshots.length} stories in batches of ${batchSize}...`);
  console.log(`📊 Found ${stories.length - storiesWithScreenshots.length} stories without screenshots`);
  
  if (useBatchAPI) {
    console.log(`🚀 Using new batch processing (multiple images per API call)`);
  } else {
    console.log(`🔄 Using individual processing (one image per API call)`);
  }

  for (let i = 0; i < storiesWithScreenshots.length; i += batchSize) {
    const batch = storiesWithScreenshots.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(storiesWithScreenshots.length / batchSize);
    
    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} stories)...`);
    
    try {
      if (useBatchAPI && batch.length > 1) {
        // Use new batch processing (multiple images in single API call)
        console.log(`  🔄 Making single API call for ${batch.length} components...`);
        
        const batchResults = await batchInspectMultipleComponents(batch, apiKey, {
          model,
          maxTokens: maxTokens * batch.length, // Scale tokens with batch size
          temperature
        });
        
        // Add successful results
        batchResults.forEach((result, index) => {
          results.push({
            success: true,
            story: batch[index],
            result: result
          });
          
          console.log(`  ✅ Completed (batch): ${batch[index].componentName} - ${batch[index].testName}`);
        });
        
      } else {
        // Use individual processing (fallback or single story)
        console.log(`  🔄 Processing individually ${batch.length > 1 ? '(fallback mode)' : '(single story)'}...`);
        
        for (let j = 0; j < batch.length; j++) {
          const story = batch[j];
          const storyNumber = i + j + 1;
          
          try {
            console.log(`  [${storyNumber}/${storiesWithScreenshots.length}] ${story.componentName} - ${story.testName}`);
            
            const result = await inspectComponent(story, apiKey, {
              model,
              maxTokens,
              temperature
            });
            
            results.push({
              success: true,
              story: story,
              result: result
            });
            
            console.log(`  ✅ Completed (individual): ${story.componentName} - ${story.testName}`);
            
            // Add delay between individual requests
            if (j < batch.length - 1 && delayBetweenRequests > 0) {
              await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
            }
            
          } catch (individualError) {
            const errorInfo = {
              success: false,
              story: story,
              error: individualError.message
            };
            
            errors.push(errorInfo);
            results.push(errorInfo);
            
            console.log(`  ❌ Failed (individual): ${story.componentName} - ${story.testName} - ${individualError.message}`);
            
            if (!continueOnError) {
              throw individualError;
            }
          }
        }
      }
      
    } catch (error) {
      console.log(`  ⚠️ Batch processing failed: ${error.message}`);
      
      if (useBatchAPI && fallbackToIndividual && batch.length > 1) {
        console.log(`  🔄 Falling back to individual processing...`);
        
        // Fallback to individual processing
        for (let j = 0; j < batch.length; j++) {
          const story = batch[j];
          const storyNumber = i + j + 1;
          
          try {
            console.log(`  [${storyNumber}/${storiesWithScreenshots.length}] ${story.componentName} - ${story.testName} (fallback)`);
            
            const result = await inspectComponent(story, apiKey, {
              model,
              maxTokens,
              temperature
            });
            
            results.push({
              success: true,
              story: story,
              result: result
            });
            
            console.log(`  ✅ Completed (fallback): ${story.componentName} - ${story.testName}`);
            
          } catch (individualError) {
            const errorInfo = {
              success: false,
              story: story,
              error: individualError.message
            };
            
            errors.push(errorInfo);
            results.push(errorInfo);
            
            console.log(`  ❌ Failed (fallback): ${story.componentName} - ${story.testName} - ${individualError.message}`);
            
            if (!continueOnError) {
              throw individualError;
            }
          }
        }
      } else {
        // No fallback available or fallback disabled
        batch.forEach(story => {
          const errorInfo = {
            success: false,
            story: story,
            error: error.message
          };
          
          errors.push(errorInfo);
          results.push(errorInfo);
        });
        
        if (!continueOnError) {
          throw error;
        }
      }
    }
    
    // Add delay between batches
    if (i + batchSize < storiesWithScreenshots.length && delayBetweenBatches > 0) {
      console.log(`  ⏳ Waiting ${delayBetweenBatches}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const errorCount = errors.length;
  
  console.log(`\n📊 Batch processing completed:`);
  console.log(`  ✅ Successful: ${successCount}`);
  console.log(`  ❌ Failed: ${errorCount}`);
  
  if (errorCount > 0) {
    console.log(`\n🚨 Errors encountered:`);
    errors.forEach(error => {
      console.log(`  - ${error.story.componentName}/${error.story.testName}: ${error.error}`);
    });
  }

  return results;
}

/**
 * Inspects components from array of story objects
 * @param {Array} stories - Array of story objects with screenshotPath
 * @param {string} apiKey - OpenAI API key
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} Analysis results
 */
async function inspectStories(stories, apiKey, options = {}) {
  if (!Array.isArray(stories)) {
    throw new Error('Input must be an array of story objects');
  }

  if (stories.length === 0) {
    console.log('⚠️  No stories provided');
    return [];
  }

  // Validate story object structure
  const invalidStories = stories.filter(story =>
    !story.componentName || !story.testName || !story.screenshotPath
  );

  if (invalidStories.length > 0) {
    console.warn(`⚠️  Found ${invalidStories.length} stories with missing required fields (componentName, testName, screenshotPath)`);
  }

  // Filter to only stories with valid screenshot paths
  const validStories = stories.filter(story => {
    if (!story.screenshotPath) return false;
    if (!fs.existsSync(story.screenshotPath)) {
      console.warn(`⚠️  Screenshot not found: ${story.screenshotPath}`);
      return false;
    }
    return true;
  });

  if (validStories.length === 0) {
    throw new Error('No stories with valid screenshot paths found');
  }

  console.log(`🎯 Processing ${validStories.length} stories with valid screenshots out of ${stories.length} total stories`);

  // Process the stories
  return await processStoriesInBatches(validStories, apiKey, options);
}

// For programmatic usage only - this script is designed to be imported and used with arrays of story objects
module.exports = {
  inspectStories,
  processStoriesInBatches
};