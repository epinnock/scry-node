// Load environment variables from .env file
require('dotenv').config();

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { getCurrentCommitId } = require('./git-utils.cjs');
const { crawlStories } = require('./crawl-stories.cjs');
const { mapStoriesToScreenshots } = require('./map-screenshots.cjs');
const { generateEmbeddings } = require('./generate-embeddings.cjs');
const { batchInspectComponents } = require('./batch-inspect-components.cjs');
const { VectorUtils } = require('./vectorutils.cjs');
const { PerformanceTimer, timeCpuOperation, createPerformanceSummary } = require('./performance-timer.cjs');
const R2Uploader = require('./r2-upload.cjs');

/**
 * Executes storycap to capture screenshots from a Storybook URL
 * @param {string} storybookUrl - URL of the deployed Storybook
 * @param {Object} options - Storycap options
 * @returns {Promise<void>}
 */
async function captureScreenshots(storybookUrl, options = {}) {
  console.log(`📸 Capturing screenshots from: ${storybookUrl}`);
  
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
  
  console.log(`Running: ${command}`);
  
  try {
    execSync(command, { stdio: 'inherit' });
    console.log('✅ Screenshots captured successfully');
  } catch (error) {
    console.error('❌ Failed to capture screenshots:', error.message);
    throw error;
  }
}

/**
 * Creates searchable text from LLM inspection results
 * @param {Object} inspection - LLM inspection result
 * @returns {string} Searchable text string
 */
function createSearchableText(inspection) {
  if (!inspection) return '';
  
  const parts = [
    // Primary description
    inspection.description || '',
    
    // Emphasize tags by adding context
    ...(inspection.tags || []).map(tag => `${tag} element`),
    
    // Include search queries for natural language matching
    ...(inspection.searchQueries || []),
    
    // Add some semantic context
    'UI component',
    'React component',
    'user interface element'
  ];
  
  return parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Processes text embedding batches in parallel with configurable concurrency
 * @param {Array} stories - Array of stories with searchableText
 * @param {string} apiKey - Jina API key
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} Combined results from all batches
 */
async function generateTextEmbeddingsInParallel(stories, apiKey, options = {}) {
  const {
    batchSize = 10,
    maxConcurrentBatches = 3, // Default to 3 concurrent batches
    delayBetweenBatches = 1000, // 1 second delay between batch starts
    enableParallel = true
  } = options;

  const https = require('https');
  
  const storiesWithText = stories.filter(story => story.searchableText);
  const results = [];
  
  if (storiesWithText.length === 0) {
    return [];
  }

  // Create batches
  const batches = [];
  for (let i = 0; i < storiesWithText.length; i += batchSize) {
    batches.push(storiesWithText.slice(i, i + batchSize));
  }

  console.log(`Processing ${storiesWithText.length} text embeddings in ${batches.length} batches of ${batchSize}...`);
  
  if (enableParallel && maxConcurrentBatches > 1) {
    console.log(`🚀 Using parallel text embedding generation (max ${maxConcurrentBatches} concurrent batches)`);
  } else {
    console.log(`🔄 Using sequential text embedding generation`);
  }

  if (!enableParallel || maxConcurrentBatches <= 1) {
    // Fall back to sequential processing
    return generateTextEmbeddings(stories, apiKey, batchSize);
  }

  // Process batches with limited concurrency
  let batchQueue = batches.map((batch, index) => ({ batch, index }));
  let activeBatches = new Set();
  let completedBatches = 0;

  /**
   * Process a single text embedding batch
   * @param {Array} batch - Stories in this batch
   * @param {number} batchIndex - Index of the batch
   * @returns {Promise<Object>} Batch results
   */
  async function processSingleTextEmbeddingBatch(batch, batchIndex) {
    const batchNumber = batchIndex + 1;
    const totalBatches = batches.length;
    
    console.log(`\n📦 Starting text embedding batch ${batchNumber}/${totalBatches} (${batch.length} texts, parallel slot ${activeBatches.size + 1})...`);
    
    const batchResults = [];

    try {
      // Prepare input for Jina API
      const textInputs = batch.map(story => ({
        text: story.searchableText
      }));
      
      const postData = JSON.stringify({
        model: 'jina-embeddings-v4',
        task: 'retrieval.query',
        input: textInputs
      });
      
      console.log(`  🔄 Making Jina text API call for ${textInputs.length} texts (batch ${batchNumber})...`);
      
      const embeddings = await new Promise((resolve, reject) => {
        const requestOptions = {
          hostname: 'api.jina.ai',
          path: '/v1/embeddings',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        };
        
        const req = https.request(requestOptions, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              const response = JSON.parse(data);
              if (response.data) {
                resolve(response.data);
              } else {
                reject(new Error(`API Error: ${data}`));
              }
            } catch (error) {
              reject(new Error(`Failed to parse API response: ${error.message}`));
            }
          });
        });
        
        req.on('error', (error) => {
          reject(error);
        });
        
        req.write(postData);
        req.end();
      });
      
      // Map embeddings back to stories
      batch.forEach((story, index) => {
        if (index < embeddings.length) {
          batchResults.push({
            ...story,
            textEmbedding: embeddings[index].embedding
          });
          console.log(`  ✅ Completed (batch ${batchNumber}): ${story.componentName} - ${story.testName}`);
        } else {
          batchResults.push(story);
          console.log(`  ⚠️ No text embedding (batch ${batchNumber}): ${story.componentName} - ${story.testName}`);
        }
      });
      
    } catch (error) {
      console.error(`  ❌ Text embedding batch ${batchNumber} failed: ${error.message}`);
      // Add stories without embeddings for failed batch
      batch.forEach(story => {
        batchResults.push(story);
      });
    }

    console.log(`  📦 Text embedding batch ${batchNumber}/${totalBatches} completed: ${batchResults.filter(r => r.textEmbedding).length}/${batch.length} successful`);
    
    return {
      batchIndex,
      results: batchResults
    };
  }

  // Process batches with controlled concurrency
  while (completedBatches < batches.length) {
    // Start new batches up to the concurrency limit
    while (activeBatches.size < maxConcurrentBatches && batchQueue.length > 0) {
      const { batch, index } = batchQueue.shift();
      
      const batchPromise = processSingleTextEmbeddingBatch(batch, index)
        .then(batchResult => {
          // Collect results
          results.push(...batchResult.results);
          
          // Remove from active set
          activeBatches.delete(batchPromise);
          completedBatches++;
          
          return batchResult;
        })
        .catch(error => {
          console.error(`❌ Text embedding batch ${index + 1} failed catastrophically: ${error.message}`);
          activeBatches.delete(batchPromise);
          completedBatches++;
          throw error;
        });

      activeBatches.add(batchPromise);
    }

    // Wait for at least one batch to complete
    if (activeBatches.size > 0) {
      await Promise.race(Array.from(activeBatches));
    }

    // Add delay between batch starts if specified
    if (batchQueue.length > 0 && delayBetweenBatches > 0) {
      console.log(`  ⏳ Waiting ${delayBetweenBatches}ms before starting next text embedding batch...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  // Wait for all remaining batches to complete
  if (activeBatches.size > 0) {
    await Promise.all(Array.from(activeBatches));
  }

  const successCount = results.filter(r => r.textEmbedding).length;
  console.log(`\n📊 Parallel text embedding generation completed: ${successCount}/${storiesWithText.length} successful`);
  console.log(`  🔄 Processed ${batches.length} batches with up to ${maxConcurrentBatches} concurrent`);

  return results;
}

/**
 * Generates text embeddings from searchable text using Jina API (sequential)
 * @param {Array} stories - Array of stories with searchableText
 * @param {string} apiKey - Jina API key
 * @param {number} batchSize - Batch size for processing
 * @returns {Promise<Array>} Stories with text embeddings
 */
async function generateTextEmbeddings(stories, apiKey, batchSize = 10) {
  const https = require('https');
  
  const storiesWithText = stories.filter(story => story.searchableText);
  const results = [];
  
  if (storiesWithText.length === 0) {
    return [];
  }
  
  console.log(`Processing ${storiesWithText.length} text embeddings in batches of ${batchSize}...`);
  
  for (let i = 0; i < storiesWithText.length; i += batchSize) {
    const batch = storiesWithText.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(storiesWithText.length / batchSize);
    
    console.log(`Processing text embedding batch ${batchNumber}/${totalBatches}...`);
    
    // Prepare input for Jina API
    const textInputs = batch.map(story => ({
      text: story.searchableText
    }));
    
    const postData = JSON.stringify({
      model: 'jina-embeddings-v4',
      task: 'retrieval.query',
      input: textInputs
    });
    
    try {
      const embeddings = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.jina.ai',
          path: '/v1/embeddings',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        };
        
        const req = https.request(options, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              const response = JSON.parse(data);
              if (response.data) {
                resolve(response.data);
              } else {
                reject(new Error(`API Error: ${data}`));
              }
            } catch (error) {
              reject(new Error(`Failed to parse API response: ${error.message}`));
            }
          });
        });
        
        req.on('error', (error) => {
          reject(error);
        });
        
        req.write(postData);
        req.end();
      });
      
      // Map embeddings back to stories
      batch.forEach((story, index) => {
        if (index < embeddings.length) {
          results.push({
            ...story,
            textEmbedding: embeddings[index].embedding
          });
        } else {
          results.push(story);
        }
      });
      
    } catch (error) {
      console.error(`Error processing text embedding batch ${batchNumber}:`, error.message);
      // Add stories without embeddings for failed batch
      batch.forEach(story => {
        results.push(story);
      });
    }
    
    // Add delay between batches
    if (i + batchSize < storiesWithText.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}

/**
 * Complete Storybook analysis pipeline
 * @param {Object} config - Configuration options
 * @returns {Promise<Array>} Complete analysis results
 */
async function analyzeStorybook(config) {
  const {
    storybookUrl,
    storiesDir = './stories',
    screenshotsDir = './__screenshots__',
    jinaApiKey,
    openaiApiKey,
    batchSize = 10,
    skipScreenshots = false,
    skipEmbeddings = false,
    skipInspection = false,
    skipMilvusUpload = false,
    skipR2Upload = false,
    enablePerformanceLogging = false,
    storycapOptions = {},
    inspectionOptions = {},
    milvusOptions = {},
    r2AccountId,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2BucketName,
    r2PublicDomain,
    r2BasePath
  } = config;
  
  const startTime = Date.now();
  console.log('🚀 Starting Storybook analysis pipeline...\n');
  
  // Get current commit ID for GitHub links with error handling
  let currentCommitId = null;
  let projectRepo = process.env.PROJECT_REPO;
  
  try {
    currentCommitId = getCurrentCommitId();
    console.log(`📝 Current commit ID: ${currentCommitId.substring(0, 7)}...`);
  } catch (error) {
    console.warn(`⚠️  Warning: Failed to get current commit ID: ${error.message}`);
    console.warn('⚠️  GitHub links will not be generated for stories');
  }
  
  // Validate PROJECT_REPO environment variable
  if (!projectRepo) {
    console.warn('⚠️  Warning: PROJECT_REPO environment variable not set');
    console.warn('⚠️  GitHub links will not be generated for stories');
  } else if (currentCommitId) {
    console.log(`🔗 GitHub links will be generated using: ${projectRepo}`);
  }
  
  const timings = {
    screenshots: null,
    crawling: null,
    mapping: null,
    embeddings: null,
    inspection: null,
    textEmbeddings: null,
    r2Upload: null,
    milvusUpload: null,
    total: null
  };
  
  // Step 1: Capture screenshots (if not skipped)
  if (!skipScreenshots && storybookUrl) {
    const timer = new PerformanceTimer('Screenshot Capture').start();
    await captureScreenshots(storybookUrl, storycapOptions);
    timings.screenshots = timer.endAndLog(enablePerformanceLogging);
    console.log(`⏱️  Screenshot capture completed in ${formatDuration(timings.screenshots.wallTime)}\n`);
  } else if (skipScreenshots) {
    console.log('⏭️  Skipping screenshot capture\n');
  } else {
    console.log('⚠️  No Storybook URL provided, skipping screenshot capture\n');
  }
  
  // Step 2: Crawl stories
  console.log(`📋 Analyzing story files in: ${storiesDir}`);
  const crawlTimer = new PerformanceTimer('Story Crawling').start();
  const stories = crawlStories(storiesDir);
  timings.crawling = crawlTimer.endAndLog(enablePerformanceLogging);
  console.log(`Found ${stories.length} story entries in ${formatDuration(timings.crawling.wallTime)}\n`);
  
  // Step 3: Map screenshots
  console.log(`🔗 Mapping screenshots from: ${screenshotsDir}`);
  const mapTimer = new PerformanceTimer('Screenshot Mapping').start();
  const storiesWithScreenshots = mapStoriesToScreenshots(storiesDir, screenshotsDir);
  const withScreenshots = storiesWithScreenshots.filter(s => s.screenshotPath).length;
  timings.mapping = mapTimer.endAndLog(enablePerformanceLogging);
  console.log(`Mapped ${withScreenshots} stories to screenshots in ${formatDuration(timings.mapping.wallTime)}\n`);
  
  // Step 4: Upload screenshots to R2 (if not skipped and credentials provided)
  let storiesWithR2 = storiesWithScreenshots;
  
  if (!skipR2Upload && r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2BucketName) {
    console.log(`☁️  Uploading screenshots to Cloudflare R2...`);
    const r2Timer = new PerformanceTimer('R2 Screenshot Upload').start();
    
    try {
      const r2Uploader = new R2Uploader({
        accountId: r2AccountId,
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
        bucketName: r2BucketName,
        publicDomain: r2PublicDomain
      });
      
      // Filter stories that have screenshots to upload
      const screenshotsToUpload = storiesWithScreenshots.filter(story => story.screenshotPath && fs.existsSync(story.screenshotPath));
      
      if (screenshotsToUpload.length === 0) {
        console.log('⚠️  No screenshots found to upload to R2\n');
      } else {
        console.log(`📤 Uploading ${screenshotsToUpload.length} screenshots to R2...`);
        
        // Determine base R2 path
        const baseR2Path = r2BasePath || path.basename(process.cwd());
        
        // Extract file paths for upload
        const filePaths = screenshotsToUpload.map(story => story.screenshotPath);
        
        // Upload files to R2 with parallel processing
        const r2UploadOptions = {
          batchSize: config.r2UploadOptions?.batchSize || 5,
          maxConcurrentBatches: config.r2UploadOptions?.maxConcurrentBatches || 3,
          enableParallel: config.r2UploadOptions?.enableParallel !== false,
          delayBetweenBatches: config.r2UploadOptions?.delayBetweenBatches || 500
        };
        
        const uploadResults = await r2Uploader.uploadFilesInParallel(filePaths, baseR2Path, r2UploadOptions);
        
        // Map R2 URLs back to stories
        storiesWithR2 = storiesWithScreenshots.map(story => {
          if (story.screenshotPath) {
            const uploadResult = uploadResults.find(result => result.originalPath === story.screenshotPath);
            if (uploadResult && uploadResult.r2Url) {
              return {
                ...story,
                screenshotR2Url: uploadResult.r2Url
              };
            }
          }
          return story;
        });
        
        const uploadedCount = uploadResults.length;
        console.log(`✅ Successfully uploaded ${uploadedCount} screenshots to R2`);
      }
      
      timings.r2Upload = r2Timer.endAndLog(enablePerformanceLogging);
      console.log(`R2 upload completed in ${formatDuration(timings.r2Upload.wallTime)}\n`);
      
    } catch (error) {
      timings.r2Upload = r2Timer.endAndLog(enablePerformanceLogging);
      console.error(`❌ Failed to upload to R2: ${error.message}\n`);
      // Continue with pipeline even if R2 upload fails
    }
  } else if (skipR2Upload) {
    console.log('⏭️  Skipping R2 upload\n');
  } else {
    console.log('⚠️  No R2 configuration provided, skipping R2 upload\n');
  }
  
  // Step 5: Run visual embedding generation and LLM component inspection in parallel
  let finalResults = storiesWithR2;
  
  // Determine which operations to run
  const shouldRunEmbeddings = !skipEmbeddings && jinaApiKey;
  const shouldRunInspection = !skipInspection && openaiApiKey;
  
  if (shouldRunEmbeddings || shouldRunInspection) {
    console.log(`🚀 Running AI processing operations in parallel...`);
    
    const parallelOperations = [];
    
    // Prepare embedding generation operation
    if (shouldRunEmbeddings) {
      console.log(`🧠 Starting visual embedding generation (batch size: ${batchSize})`);
      const embeddingTimer = new PerformanceTimer('Visual Embedding Generation').start();
      
      const embeddingOptions = {
        maxConcurrentBatches: config.embeddingOptions?.maxConcurrentBatches || 3,
        enableParallel: config.embeddingOptions?.enableParallel !== false,
        delayBetweenBatches: config.embeddingOptions?.delayBetweenBatches || 1000
      };
      
      const embeddingOperation = generateEmbeddings(storiesWithR2, screenshotsDir, jinaApiKey, batchSize, embeddingOptions)
        .then(results => {
          const withEmbeddings = results.filter(s => s.embedding).length;
          timings.embeddings = embeddingTimer.endAndLog(enablePerformanceLogging);
          console.log(`✅ Visual embedding generation completed: ${withEmbeddings} stories in ${formatDuration(timings.embeddings.wallTime)}`);
          return { type: 'embeddings', results };
        });
      
      parallelOperations.push(embeddingOperation);
    }
    
    // Prepare LLM inspection operation
    if (shouldRunInspection) {
      console.log(`🔍 Starting LLM component inspection...`);
      const inspectionTimer = new PerformanceTimer('LLM Component Inspection').start();
      
      const inspectionOperation = batchInspectComponents(storiesWithR2, openaiApiKey, {
        batchSize: inspectionOptions.batchSize || 5,
        maxConcurrentBatches: inspectionOptions.maxConcurrentBatches || 3,
        enableParallel: inspectionOptions.enableParallel !== false,
        delayBetweenBatches: inspectionOptions.delayBetweenBatches || 2000,
        delayBetweenRequests: inspectionOptions.delayBetweenRequests || 1000,
        model: inspectionOptions.model || 'gpt-5-mini',
        maxTokens: inspectionOptions.maxTokens || 1500,
        temperature: inspectionOptions.temperature || 1,
        continueOnError: inspectionOptions.continueOnError !== false,
        includeMetadata: false // Don't include metadata to keep output clean
      }).then(inspectionResults => {
        const withInspections = inspectionResults.filter(r => r.success).length;
        timings.inspection = inspectionTimer.endAndLog(enablePerformanceLogging);
        console.log(`✅ LLM component inspection completed: ${withInspections} stories in ${formatDuration(timings.inspection.wallTime)}`);
        return { type: 'inspection', results: inspectionResults };
      });
      
      parallelOperations.push(inspectionOperation);
    }
    
    
    // Execute operations in parallel
    console.log(`⚡ Running ${parallelOperations.length} AI operations in parallel...`);
    const parallelResults = await Promise.all(parallelOperations);
    
    // Process results and merge them back into finalResults
    let embeddingResults = null;
    let inspectionResults = null;
    
    parallelResults.forEach(result => {
      if (result.type === 'embeddings') {
        embeddingResults = result.results;
      } else if (result.type === 'inspection') {
        inspectionResults = result.results;
      }
    });
    
    // Merge embedding results
    if (embeddingResults) {
      finalResults = embeddingResults;
    }
    
    // Merge inspection results
    if (inspectionResults) {
      finalResults = finalResults.map(story => {
        const inspectionResult = inspectionResults.find(r =>
          r.success &&
          r.story.componentName === story.componentName &&
          r.story.testName === story.testName
        );
        
        if (inspectionResult && inspectionResult.result) {
          const updatedStory = {
            ...story,
            inspection: inspectionResult.result
          };
          
          // Add GitHub URL if we have the required data
          if (currentCommitId && projectRepo && story.filepath && story.location) {
            const { startLine, endLine } = story.location;
            updatedStory.githubUrl = `${projectRepo}/blob/${currentCommitId}/${story.filepath}#L${startLine}-L${endLine}`;
          }
          
          return updatedStory;
        }
        
        // Add GitHub URL for stories without inspection if we have the required data
        if (currentCommitId && projectRepo && story.filepath && story.location) {
          const { startLine, endLine } = story.location;
          return {
            ...story,
            githubUrl: `${projectRepo}/blob/${currentCommitId}/${story.filepath}#L${startLine}-L${endLine}`
          };
        }
        
        return story;
      });
    }
    
    const finalWithEmbeddings = finalResults.filter(s => s.embedding).length;
    const finalWithInspections = finalResults.filter(s => s.inspection).length;
    
    console.log(`\n📊 Parallel AI processing completed:`);
    if (shouldRunEmbeddings) {
      console.log(`  🧠 Visual embeddings: ${finalWithEmbeddings} stories`);
    }
    if (shouldRunInspection) {
      console.log(`  🔍 LLM inspections: ${finalWithInspections} stories`);
    }
    console.log('');
    
  } else {
    // Handle skipped operations
    if (skipEmbeddings) {
      console.log('⏭️  Skipping embedding generation');
    } else if (!jinaApiKey) {
      console.log('⚠️  No Jina API key provided, skipping embedding generation');
    }
    
    if (skipInspection) {
      console.log('⏭️  Skipping LLM component inspection');
    } else if (!openaiApiKey) {
      console.log('⚠️  No OpenAI API key provided, skipping LLM component inspection');
    }
    console.log('');
  }
  
  // Step 6: Generate text embeddings from inspection results (if we have both API keys and inspections)
  if (!skipEmbeddings && jinaApiKey && !skipInspection && finalResults.some(s => s.inspection)) {
    console.log(`📝 Generating text embeddings from LLM inspection results...`);
    const textEmbeddingTimer = new PerformanceTimer('Text Embedding Generation').start();
    
    // Create searchable text for each story with inspection
    const storiesWithSearchableText = finalResults.map(story => {
      if (story.inspection) {
        return {
          ...story,
          searchableText: createSearchableText(story.inspection)
        };
      }
      return story;
    });
    
    // Generate embeddings for the searchable text with parallel processing
    try {
      const textEmbeddingOptions = {
        batchSize: batchSize,
        maxConcurrentBatches: config.textEmbeddingOptions?.maxConcurrentBatches || 3,
        enableParallel: config.textEmbeddingOptions?.enableParallel !== false,
        delayBetweenBatches: config.textEmbeddingOptions?.delayBetweenBatches || 1000
      };
      
      const textEmbeddings = await generateTextEmbeddingsInParallel(storiesWithSearchableText, jinaApiKey, textEmbeddingOptions);
      
      // Merge text embeddings back into final results
      finalResults = finalResults.map(story => {
        const textEmbeddingResult = textEmbeddings.find(t =>
          t.componentName === story.componentName &&
          t.testName === story.testName
        );
        
        if (textEmbeddingResult && textEmbeddingResult.textEmbedding) {
          return {
            ...story,
            searchableText: textEmbeddingResult.searchableText,
            textEmbedding: textEmbeddingResult.textEmbedding
          };
        }
        
        return story;
      });
      
      const withTextEmbeddings = finalResults.filter(s => s.textEmbedding).length;
      timings.textEmbeddings = textEmbeddingTimer.endAndLog(enablePerformanceLogging);
      console.log(`Generated text embeddings for ${withTextEmbeddings} stories in ${formatDuration(timings.textEmbeddings.wallTime)}\n`);
    } catch (error) {
      timings.textEmbeddings = textEmbeddingTimer.endAndLog(enablePerformanceLogging);
      console.error(`⚠️  Failed to generate text embeddings: ${error.message}\n`);
    }
  }
  
  // Step 8: Upload to Milvus (if not skipped and we have processed data)
  if (!skipMilvusUpload && milvusOptions.address && milvusOptions.token) {
    console.log(`🗄️  Uploading to Milvus vector database...`);
    const milvusTimer = new PerformanceTimer('Milvus Vector Database Upload').start();
    
    try {
      const vectorUtils = new VectorUtils({
        address: milvusOptions.address,
        token: milvusOptions.token,
        collectionName: milvusOptions.collectionName || 'storybook_components',
        projectId: milvusOptions.projectId || 'default-project'
      });
      
      // Setup collection if needed
      if (milvusOptions.setupCollection) {
        console.log(`🔧 Setting up Milvus collection...`);
        await vectorUtils.setupCollection();
      }
      
      // Filter stories that have the required data
      const uploadableStories = finalResults.filter(story =>
        story.screenshotPath && (story.embedding || story.textEmbedding || story.inspection)
      );
      
      if (uploadableStories.length === 0) {
        console.log('⚠️  No uploadable stories found (need screenshots and embeddings/inspection data)\n');
      } else {
        // Transform the data to match the expected format
        const transformedStories = uploadableStories.map(story => ({
          ...story,
          image_embedding: story.embedding || story.image_embedding, // Support both field names
          textEmbedding: story.textEmbedding || story.text_embedding   // Support both field names
        }));
        
        const uploadResult = await vectorUtils.insertStoryData(transformedStories, {
          batchSize: milvusOptions.batchSize || 50,
          continueOnError: milvusOptions.continueOnError !== false
        });
        
        console.log(`✅ Successfully uploaded ${uploadResult.totalInserted} entries to Milvus`);
        
        // Add upload result to final results metadata
        finalResults.milvusUploadResult = uploadResult;
      }
      
      await vectorUtils.close();
      timings.milvusUpload = milvusTimer.endAndLog(enablePerformanceLogging);
      console.log(`Milvus upload completed in ${formatDuration(timings.milvusUpload.wallTime)}\n`);
      
    } catch (error) {
      timings.milvusUpload = milvusTimer.endAndLog(enablePerformanceLogging);
      console.error(`❌ Failed to upload to Milvus: ${error.message}\n`);
      if (!milvusOptions.continueOnError) {
        throw error;
      }
    }
  } else if (skipMilvusUpload) {
    console.log('⏭️  Skipping Milvus upload\n');
  } else {
    console.log('⚠️  No Milvus configuration provided, skipping vector database upload\n');
  }
  
  // Calculate total time and display summary
  timings.total = { wallTime: Date.now() - startTime, name: 'Total Pipeline' };
  console.log('✅ Analysis pipeline completed!');
  
  // Create and display performance summary
  if (enablePerformanceLogging) {
    createPerformanceSummary(timings, true);
  } else {
    // Show basic timing summary (existing behavior)
    console.log('\n📊 Timing Summary:');
    if (timings.screenshots && timings.screenshots.wallTime > 0) {
      console.log(`  📸 Screenshot capture: ${formatDuration(timings.screenshots.wallTime)}`);
    }
    console.log(`  📋 Story crawling: ${formatDuration(timings.crawling.wallTime)}`);
    console.log(`  🔗 Screenshot mapping: ${formatDuration(timings.mapping.wallTime)}`);
    if (timings.r2Upload && timings.r2Upload.wallTime > 0) {
      console.log(`  ☁️  R2 screenshot upload: ${formatDuration(timings.r2Upload.wallTime)}`);
    }
    if (timings.embeddings && timings.embeddings.wallTime > 0) {
      console.log(`  🧠 Visual embedding generation: ${formatDuration(timings.embeddings.wallTime)}`);
    }
    if (timings.inspection && timings.inspection.wallTime > 0) {
      console.log(`  🔍 LLM component inspection: ${formatDuration(timings.inspection.wallTime)}`);
    }
    if (timings.textEmbeddings && timings.textEmbeddings.wallTime > 0) {
      console.log(`  📝 Text embedding generation: ${formatDuration(timings.textEmbeddings.wallTime)}`);
    }
    if (timings.milvusUpload && timings.milvusUpload.wallTime > 0) {
      console.log(`  🗄️  Milvus vector database upload: ${formatDuration(timings.milvusUpload.wallTime)}`);
    }
    console.log(`  ⏱️  Total execution time: ${formatDuration(timings.total.wallTime)}`);
  }
  
  return finalResults;
}

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed configuration
 */
function parseArguments(args) {
  const config = {
    // Set defaults from environment variables, with hardcoded fallbacks
    storybookUrl: process.env.STORYBOOK_URL || undefined,
    storiesDir: process.env.STORIES_DIR || './stories',
    screenshotsDir: process.env.SCREENSHOTS_DIR || './__screenshots__',
    jinaApiKey: process.env.JINA_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    batchSize: process.env.EMBEDDINGS_BATCH_SIZE ? parseInt(process.env.EMBEDDINGS_BATCH_SIZE) : 10,
    skipScreenshots: process.env.SKIP_SCREENSHOTS === 'true' || false,
    skipEmbeddings: process.env.SKIP_EMBEDDINGS === 'true' || false,
    skipInspection: process.env.SKIP_INSPECTION === 'true' || false,
    skipMilvusUpload: process.env.SKIP_MILVUS_UPLOAD === 'true' || false,
    skipR2Upload: process.env.SKIP_R2_UPLOAD === 'true' || false,
    enablePerformanceLogging: process.env.ENABLE_PERFORMANCE_LOGGING === 'true' || false,
    // R2 configuration from environment variables
    r2AccountId: process.env.CLOUDFLARE_ACCOUNT_ID || undefined,
    r2AccessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID || undefined,
    r2SecretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY || undefined,
    r2BucketName: process.env.R2_BUCKET_NAME || undefined,
    r2PublicDomain: process.env.R2_PUBLIC_DOMAIN || undefined,
    r2BasePath: process.env.R2_BASE_PATH || undefined,
    // Milvus configuration from environment variables
    milvusOptions: {
      address: process.env.MILVUS_ADDRESS || undefined,
      token: process.env.MILVUS_TOKEN || undefined,
      collectionName: process.env.MILVUS_COLLECTION || 'storybook_components',
      projectId: process.env.PROJECT_ID || 'default-project',
      batchSize: process.env.MILVUS_BATCH_SIZE ? parseInt(process.env.MILVUS_BATCH_SIZE) : 50,
      setupCollection: process.env.MILVUS_SETUP_COLLECTION === 'true' || false,
      continueOnError: process.env.MILVUS_CONTINUE_ON_ERROR !== 'false'
    },
    // Inspection options from environment variables
    inspectionOptions: {
      batchSize: process.env.INSPECTION_BATCH_SIZE ? parseInt(process.env.INSPECTION_BATCH_SIZE) : 5,
      maxConcurrentBatches: process.env.INSPECTION_MAX_CONCURRENT ? parseInt(process.env.INSPECTION_MAX_CONCURRENT) : 3,
      enableParallel: process.env.INSPECTION_ENABLE_PARALLEL !== 'false',
      model: process.env.INSPECTION_MODEL || 'gpt-5-mini',
      delayBetweenBatches: process.env.INSPECTION_DELAY_BATCHES ? parseInt(process.env.INSPECTION_DELAY_BATCHES) : 2000,
      delayBetweenRequests: process.env.INSPECTION_DELAY_REQUESTS ? parseInt(process.env.INSPECTION_DELAY_REQUESTS) : 1000,
      maxTokens: process.env.INSPECTION_MAX_TOKENS ? parseInt(process.env.INSPECTION_MAX_TOKENS) : 1500,
      temperature: process.env.INSPECTION_TEMPERATURE ? parseFloat(process.env.INSPECTION_TEMPERATURE) : 1,
      continueOnError: process.env.INSPECTION_CONTINUE_ON_ERROR !== 'false'
    },
    // Embedding options from environment variables
    embeddingOptions: {
      maxConcurrentBatches: process.env.EMBEDDING_MAX_CONCURRENT ? parseInt(process.env.EMBEDDING_MAX_CONCURRENT) : 3,
      enableParallel: process.env.EMBEDDING_ENABLE_PARALLEL !== 'false',
      delayBetweenBatches: process.env.EMBEDDING_DELAY_BATCHES ? parseInt(process.env.EMBEDDING_DELAY_BATCHES) : 1000
    },
    // Text embedding options from environment variables
    textEmbeddingOptions: {
      maxConcurrentBatches: process.env.TEXT_EMBEDDING_MAX_CONCURRENT ? parseInt(process.env.TEXT_EMBEDDING_MAX_CONCURRENT) : 3,
      enableParallel: process.env.TEXT_EMBEDDING_ENABLE_PARALLEL !== 'false',
      delayBetweenBatches: process.env.TEXT_EMBEDDING_DELAY_BATCHES ? parseInt(process.env.TEXT_EMBEDDING_DELAY_BATCHES) : 1000
    },
    // R2 upload options from environment variables
    r2UploadOptions: {
      batchSize: process.env.R2_UPLOAD_BATCH_SIZE ? parseInt(process.env.R2_UPLOAD_BATCH_SIZE) : 5,
      maxConcurrentBatches: process.env.R2_UPLOAD_MAX_CONCURRENT ? parseInt(process.env.R2_UPLOAD_MAX_CONCURRENT) : 3,
      enableParallel: process.env.R2_UPLOAD_ENABLE_PARALLEL !== 'false',
      delayBetweenBatches: process.env.R2_UPLOAD_DELAY_BATCHES ? parseInt(process.env.R2_UPLOAD_DELAY_BATCHES) : 500
    },
    // Storycap options from environment variables
    storycapOptions: {
      chromiumPath: process.env.CHROMIUM_PATH || undefined,
      outDir: process.env.STORYCAP_OUT_DIR || undefined,
      parallel: process.env.STORYCAP_PARALLEL ? parseInt(process.env.STORYCAP_PARALLEL) : undefined,
      delay: process.env.STORYCAP_DELAY ? parseInt(process.env.STORYCAP_DELAY) : undefined,
      include: process.env.STORYCAP_INCLUDE || undefined,
      exclude: process.env.STORYCAP_EXCLUDE || undefined,
      omitBackground: process.env.STORYCAP_OMIT_BACKGROUND !== 'false'
    }
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--storybook-url':
      case '--url':
        config.storybookUrl = nextArg;
        i++;
        break;
        
      case '--stories-dir':
        config.storiesDir = nextArg;
        i++;
        break;
        
      case '--screenshots-dir':
        config.screenshotsDir = nextArg;
        i++;
        break;
        
      case '--jina-api-key':
        config.jinaApiKey = nextArg;
        i++;
        break;
        
      case '--openai-api-key':
        config.openaiApiKey = nextArg;
        i++;
        break;
        
      case '--api-key':
        // For backwards compatibility, treat as Jina API key
        config.jinaApiKey = nextArg;
        i++;
        break;
        
      case '--batch-size':
        config.batchSize = parseInt(nextArg);
        i++;
        break;
        
      case '--skip-screenshots':
        config.skipScreenshots = true;
        break;
        
      case '--skip-embeddings':
        config.skipEmbeddings = true;
        break;
        
      case '--skip-inspection':
        config.skipInspection = true;
        break;
        
      case '--skip-milvus':
      case '--skip-milvus-upload':
        config.skipMilvusUpload = true;
        break;
        
      case '--skip-r2':
      case '--skip-r2-upload':
        config.skipR2Upload = true;
        break;
        
      case '--r2-account-id':
        config.r2AccountId = nextArg;
        i++;
        break;
        
      case '--r2-access-key-id':
        config.r2AccessKeyId = nextArg;
        i++;
        break;
        
      case '--r2-secret-access-key':
        config.r2SecretAccessKey = nextArg;
        i++;
        break;
        
      case '--r2-bucket-name':
        config.r2BucketName = nextArg;
        i++;
        break;
        
      case '--r2-public-domain':
        config.r2PublicDomain = nextArg;
        i++;
        break;
        
      case '--r2-base-path':
        config.r2BasePath = nextArg;
        i++;
        break;
        
      case '--output':
      case '-o':
        config.outputFile = nextArg;
        i++;
        break;
        
      case '--pretty':
        config.prettyOutput = true;
        break;
        
      // LLM Inspection options
      case '--inspection-batch-size':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.batchSize = parseInt(nextArg);
        i++;
        break;
        
      case '--inspection-model':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.model = nextArg;
        i++;
        break;
        
      case '--inspection-delay-batches':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.delayBetweenBatches = parseInt(nextArg);
        i++;
        break;
        
      case '--inspection-delay-requests':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.delayBetweenRequests = parseInt(nextArg);
        i++;
        break;
        
      case '--inspection-max-tokens':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.maxTokens = parseInt(nextArg);
        i++;
        break;
        
      case '--inspection-temperature':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.temperature = parseFloat(nextArg);
        i++;
        break;
        
      case '--inspection-stop-on-error':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.continueOnError = false;
        break;
        
      case '--inspection-max-concurrent':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.maxConcurrentBatches = parseInt(nextArg);
        i++;
        break;
        
      case '--inspection-no-parallel':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.enableParallel = false;
        break;
        
      case '--inspection-enable-parallel':
        if (!config.inspectionOptions) config.inspectionOptions = {};
        config.inspectionOptions.enableParallel = true;
        break;
        
      // Embedding options
      case '--embedding-max-concurrent':
        if (!config.embeddingOptions) config.embeddingOptions = {};
        config.embeddingOptions.maxConcurrentBatches = parseInt(nextArg);
        i++;
        break;
        
      case '--embedding-no-parallel':
        if (!config.embeddingOptions) config.embeddingOptions = {};
        config.embeddingOptions.enableParallel = false;
        break;
        
      case '--embedding-enable-parallel':
        if (!config.embeddingOptions) config.embeddingOptions = {};
        config.embeddingOptions.enableParallel = true;
        break;
        
      case '--embedding-delay-batches':
        if (!config.embeddingOptions) config.embeddingOptions = {};
        config.embeddingOptions.delayBetweenBatches = parseInt(nextArg);
        i++;
        break;
        
      // Text embedding options
      case '--text-embedding-max-concurrent':
        if (!config.textEmbeddingOptions) config.textEmbeddingOptions = {};
        config.textEmbeddingOptions.maxConcurrentBatches = parseInt(nextArg);
        i++;
        break;
        
      case '--text-embedding-no-parallel':
        if (!config.textEmbeddingOptions) config.textEmbeddingOptions = {};
        config.textEmbeddingOptions.enableParallel = false;
        break;
        
      case '--text-embedding-enable-parallel':
        if (!config.textEmbeddingOptions) config.textEmbeddingOptions = {};
        config.textEmbeddingOptions.enableParallel = true;
        break;
        
      case '--text-embedding-delay-batches':
        if (!config.textEmbeddingOptions) config.textEmbeddingOptions = {};
        config.textEmbeddingOptions.delayBetweenBatches = parseInt(nextArg);
        i++;
        break;
        
      // R2 upload options
      case '--r2-upload-batch-size':
        if (!config.r2UploadOptions) config.r2UploadOptions = {};
        config.r2UploadOptions.batchSize = parseInt(nextArg);
        i++;
        break;
        
      case '--r2-upload-max-concurrent':
        if (!config.r2UploadOptions) config.r2UploadOptions = {};
        config.r2UploadOptions.maxConcurrentBatches = parseInt(nextArg);
        i++;
        break;
        
      case '--r2-upload-no-parallel':
        if (!config.r2UploadOptions) config.r2UploadOptions = {};
        config.r2UploadOptions.enableParallel = false;
        break;
        
      case '--r2-upload-enable-parallel':
        if (!config.r2UploadOptions) config.r2UploadOptions = {};
        config.r2UploadOptions.enableParallel = true;
        break;
        
      case '--r2-upload-delay-batches':
        if (!config.r2UploadOptions) config.r2UploadOptions = {};
        config.r2UploadOptions.delayBetweenBatches = parseInt(nextArg);
        i++;
        break;
        
      // Milvus options
      case '--milvus-address':
        if (!config.milvusOptions) config.milvusOptions = {};
        config.milvusOptions.address = nextArg;
        i++;
        break;
        
      case '--milvus-token':
        if (!config.milvusOptions) config.milvusOptions = {};
        config.milvusOptions.token = nextArg;
        i++;
        break;
        
      case '--milvus-collection':
        if (!config.milvusOptions) config.milvusOptions = {};
        config.milvusOptions.collectionName = nextArg;
        i++;
        break;
        
      case '--milvus-project-id':
        if (!config.milvusOptions) config.milvusOptions = {};
        config.milvusOptions.projectId = nextArg;
        i++;
        break;
        
      case '--milvus-batch-size':
        if (!config.milvusOptions) config.milvusOptions = {};
        config.milvusOptions.batchSize = parseInt(nextArg);
        i++;
        break;
        
      case '--milvus-setup-collection':
        if (!config.milvusOptions) config.milvusOptions = {};
        config.milvusOptions.setupCollection = true;
        break;
        
      case '--milvus-stop-on-error':
        if (!config.milvusOptions) config.milvusOptions = {};
        config.milvusOptions.continueOnError = false;
        break;
        
      // Storycap options
      case '--chromium-path':
        config.storycapOptions.chromiumPath = nextArg;
        i++;
        break;
        
      case '--out-dir':
        config.storycapOptions.outDir = nextArg;
        i++;
        break;
        
      case '--parallel':
        config.storycapOptions.parallel = parseInt(nextArg);
        i++;
        break;
        
      case '--delay':
        config.storycapOptions.delay = parseInt(nextArg);
        i++;
        break;
        
      case '--include':
        config.storycapOptions.include = nextArg;
        i++;
        break;
        
      case '--exclude':
        config.storycapOptions.exclude = nextArg;
        i++;
        break;
        
      case '--no-omit-background':
        config.storycapOptions.omitBackground = false;
        break;
        
      case '--performance':
      case '--perf':
        config.enablePerformanceLogging = true;
        break;
        
      case '--help':
      case '-h':
        config.showHelp = true;
        break;
    }
  }
  
  return config;
}

/**
 * Formats duration in milliseconds to human-readable format
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms.toFixed(1)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Display help information
 */
function showHelp() {
  console.log(`
🔍 Storybook Analysis Tool

Complete pipeline for analyzing Storybook stories, capturing screenshots, and generating AI embeddings.

USAGE:
  node scripts/analyze-storybook.js [options]

REQUIRED OPTIONS:
  --storybook-url <url>     URL of deployed Storybook (for screenshot capture)

API KEYS:
  --jina-api-key <key>     Jina API key (for embedding generation)
  --openai-api-key <key>   OpenAI API key (for LLM component inspection)
  --api-key <key>          Jina API key (backwards compatibility)

GENERAL OPTIONS:
  --stories-dir <path>     Directory containing story files (default: ./stories)
  --screenshots-dir <path> Directory for screenshots (default: ./__screenshots__)
  --batch-size <number>    Batch size for embedding generation (default: 10)
  --output <file>          Output file for results (default: stdout)
  --pretty                 Pretty-print JSON output
  --skip-screenshots       Skip screenshot capture step
  --skip-embeddings        Skip embedding generation step
  --skip-inspection        Skip LLM component inspection step
  --skip-milvus            Skip Milvus vector database upload
  --skip-r2                Skip Cloudflare R2 screenshot upload
  --performance            Enable detailed CPU vs wall time performance logging
  --help, -h               Show this help message

CLOUDFLARE R2 UPLOAD OPTIONS:
  --r2-account-id <id>             Cloudflare Account ID
  --r2-access-key-id <key>         R2 Access Key ID
  --r2-secret-access-key <secret>  R2 Secret Access Key
  --r2-bucket-name <name>          R2 bucket name
  --r2-public-domain <domain>      Custom public domain for R2 (optional)
  --r2-base-path <path>            Base path within R2 bucket (optional, defaults to project name)

LLM INSPECTION OPTIONS:
  --inspection-batch-size <number>      Stories per inspection batch (default: 5)
  --inspection-model <model>            OpenAI model (default: gpt-5-mini)
  --inspection-delay-batches <ms>       Delay between inspection batches (default: 2000)
  --inspection-delay-requests <ms>      Delay between inspection requests (default: 1000)
  --inspection-max-tokens <number>      Max tokens per inspection (default: 1500)
  --inspection-temperature <number>     AI temperature for inspection (default: 1)
  --inspection-stop-on-error           Stop on first inspection error
  --inspection-max-concurrent <number> Max concurrent inspection batches (default: 3)
  --inspection-no-parallel             Disable parallel inspection processing
  --inspection-enable-parallel         Enable parallel inspection processing (default: true)

EMBEDDING GENERATION OPTIONS:
  --embedding-max-concurrent <number>  Max concurrent embedding batches (default: 3)
  --embedding-no-parallel              Disable parallel embedding processing
  --embedding-enable-parallel          Enable parallel embedding processing (default: true)
  --embedding-delay-batches <ms>       Delay between embedding batches (default: 1000)

TEXT EMBEDDING GENERATION OPTIONS:
  --text-embedding-max-concurrent <number>  Max concurrent text embedding batches (default: 3)
  --text-embedding-no-parallel              Disable parallel text embedding processing
  --text-embedding-enable-parallel          Enable parallel text embedding processing (default: true)
  --text-embedding-delay-batches <ms>       Delay between text embedding batches (default: 1000)

R2 UPLOAD OPTIONS:
  --r2-upload-batch-size <number>           Files per R2 upload batch (default: 5)
  --r2-upload-max-concurrent <number>       Max concurrent R2 upload batches (default: 3)
  --r2-upload-no-parallel                   Disable parallel R2 upload processing
  --r2-upload-enable-parallel               Enable parallel R2 upload processing (default: true)
  --r2-upload-delay-batches <ms>            Delay between R2 upload batches (default: 500)

MILVUS VECTOR DATABASE OPTIONS:
  --milvus-address <url>               Milvus server address/endpoint
  --milvus-token <token>               Milvus authentication token
  --milvus-collection <name>           Collection name (default: storybook_components)
  --milvus-project-id <id>             Project ID for data organization (default: default-project)
  --milvus-batch-size <number>         Upload batch size (default: 50)
  --milvus-setup-collection            Auto-create collection and indexes
  --milvus-stop-on-error               Stop on first upload error

STORYCAP OPTIONS:
  --chromium-path <path>   Path to Chromium executable
  --out-dir <path>         Output directory for screenshots
  --parallel <number>      Number of parallel browser instances
  --delay <ms>             Delay between screenshots
  --include <pattern>      Include stories matching pattern
  --exclude <pattern>      Exclude stories matching pattern
  --no-omit-background     Don't omit background (default: omit background)

EXAMPLES:
  # Complete analysis with screenshot capture, embeddings, LLM inspection, and Milvus upload
  node scripts/analyze-storybook.js \\
    --storybook-url https://your-storybook.vercel.app/ \\
    --jina-api-key your_jina_api_key \\
    --openai-api-key your_openai_api_key \\
    --milvus-address your_milvus_endpoint \\
    --milvus-token your_milvus_token \\
    --milvus-setup-collection \\
    --chromium-path /snap/chromium/current/usr/lib/chromium-browser/chrome

  # Analysis without screenshot capture (use existing screenshots)
  node scripts/analyze-storybook.js \\
    --skip-screenshots \\
    --jina-api-key your_jina_api_key \\
    --openai-api-key your_openai_api_key

  # Only LLM inspection without embeddings
  node scripts/analyze-storybook.js \\
    --storybook-url https://your-storybook.vercel.app/ \\
    --skip-embeddings \\
    --openai-api-key your_openai_api_key

  # Custom inspection options
  node scripts/analyze-storybook.js \\
    --storybook-url https://your-storybook.vercel.app/ \\
    --openai-api-key your_openai_api_key \\
    --inspection-model gpt-5-mini \\
    --inspection-batch-size 3 \\
    --inspection-delay-batches 3000

  # Upload to Milvus with custom settings
  node scripts/analyze-storybook.js \\
    --skip-screenshots \\
    --jina-api-key your_jina_api_key \\
    --openai-api-key your_openai_api_key \\
    --milvus-address your_milvus_endpoint \\
    --milvus-token your_milvus_token \\
    --milvus-collection my_components \\
    --milvus-project-id my_project \\
    --milvus-batch-size 25

  # Complete analysis with R2 screenshot upload
  node scripts/analyze-storybook.js \\
    --storybook-url https://your-storybook.vercel.app/ \\
    --jina-api-key your_jina_api_key \\
    --openai-api-key your_openai_api_key \\
    --r2-account-id your_cloudflare_account_id \\
    --r2-access-key-id your_r2_access_key \\
    --r2-secret-access-key your_r2_secret \\
    --r2-bucket-name your-r2-bucket \\
    --r2-public-domain your-domain.com \\
    --r2-base-path storybook-screenshots

  # Save results to file
  node scripts/analyze-storybook.js \\
    --storybook-url https://your-storybook.vercel.app/ \\
    --jina-api-key your_jina_api_key \\
    --openai-api-key your_openai_api_key \\
    --output storybook-analysis.json \\
    --pretty
`);
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const config = parseArguments(args);
  
  if (config.showHelp) {
    showHelp();
    process.exit(0);
  }
  
  // Validate required options
  if (!config.skipScreenshots && !config.storybookUrl) {
    console.error('❌ Error: --storybook-url is required unless --skip-screenshots is used');
    console.log('Use --help for usage information');
    process.exit(1);
  }
  
  if (!config.skipEmbeddings && !config.jinaApiKey) {
    console.warn('⚠️  Warning: No --jina-api-key provided. Embeddings will be skipped.');
    config.skipEmbeddings = true;
  }
  
  if (!config.skipInspection && !config.openaiApiKey) {
    console.warn('⚠️  Warning: No --openai-api-key provided. LLM inspection will be skipped.');
    config.skipInspection = true;
  }
  
  // Check for Milvus configuration
  if (!config.skipMilvusUpload) {
    if (!config.milvusOptions.address || !config.milvusOptions.token) {
      console.warn('⚠️  Warning: No Milvus configuration provided. Vector database upload will be skipped.');
      config.skipMilvusUpload = true;
    }
  }
  
  // Check for R2 configuration
  if (!config.skipR2Upload) {
    if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey || !config.r2BucketName) {
      console.warn('⚠️  Warning: No R2 configuration provided. R2 upload will be skipped.');
      config.skipR2Upload = true;
    }
  }
  
  // Run the analysis
  analyzeStorybook(config)
    .then(results => {
      const output = config.prettyOutput 
        ? JSON.stringify(results, null, 2)
        : JSON.stringify(results);
      
      if (config.outputFile) {
        fs.writeFileSync(config.outputFile, output);
        console.log(`📄 Results saved to: ${config.outputFile}`);
      } 
    })
    .catch(error => {
      console.error('❌ Analysis failed:', error.message);
      process.exit(1);
    });
}

module.exports = { analyzeStorybook, captureScreenshots, parseArguments };