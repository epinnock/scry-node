const fs = require('fs');
const path = require('path');
const https = require('https');
const { mapStoriesToScreenshots } = require('./map-screenshots.cjs');

/**
 * Converts an image file to base64 string
 * @param {string} imagePath - Path to the image file
 * @returns {string|null} Base64 encoded string or null if file doesn't exist
 */
function imageToBase64(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`Image file not found: ${imagePath}`);
      return null;
    }
    
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    console.error(`Error reading image file ${imagePath}:`, error.message);
    return null;
  }
}

/**
 * Makes a request to the Jina API to get embeddings for images
 * @param {Array} imageInputs - Array of image objects for the API
 * @param {string} apiKey - Jina API key
 * @returns {Promise<Array>} Promise that resolves to embeddings array
 */
function getJinaEmbeddings(imageInputs, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: 'jina-embeddings-v4',
      task: 'retrieval.query',
      input: imageInputs
    });

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
}

/**
 * Processes batches in parallel with configurable concurrency for embedding generation
 * @param {Array} entries - Array of test entries with screenshot paths
 * @param {string} apiKey - Jina API key
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} Combined results from all batches
 */
async function processImagesInParallelBatches(entries, apiKey, options = {}) {
  const {
    batchSize = 10,
    maxConcurrentBatches = 3, // Default to 3 concurrent batches
    delayBetweenBatches = 1000, // 1 second delay between batch starts
    enableParallel = true
  } = options;

  const results = [];
  
  // Filter entries that have screenshot paths
  const entriesWithImages = entries.filter(entry => entry.screenshotPath);
  
  if (entriesWithImages.length === 0) {
    console.log('No entries with screenshot paths found.');
    // Add entries without screenshot paths
    const entriesWithoutImages = entries.filter(entry => !entry.screenshotPath);
    entriesWithoutImages.forEach(entry => {
      results.push({ ...entry, embedding: null });
    });
    return results;
  }

  // Create batches
  const batches = [];
  for (let i = 0; i < entriesWithImages.length; i += batchSize) {
    batches.push(entriesWithImages.slice(i, i + batchSize));
  }

  console.log(`Processing ${entriesWithImages.length} images in ${batches.length} batches of ${batchSize}...`);
  
  if (enableParallel && maxConcurrentBatches > 1) {
    console.log(`🚀 Using parallel embedding generation (max ${maxConcurrentBatches} concurrent batches)`);
  } else {
    console.log(`🔄 Using sequential embedding generation`);
  }

  if (!enableParallel || maxConcurrentBatches <= 1) {
    // Fall back to sequential processing
    return processImagesInBatches(entries, apiKey, batchSize);
  }

  // Process batches with limited concurrency
  let batchQueue = batches.map((batch, index) => ({ batch, index }));
  let activeBatches = new Set();
  let completedBatches = 0;

  /**
   * Process a single embedding batch
   * @param {Array} batch - Entries in this batch
   * @param {number} batchIndex - Index of the batch
   * @returns {Promise<Object>} Batch results
   */
  async function processSingleEmbeddingBatch(batch, batchIndex) {
    const batchNumber = batchIndex + 1;
    const totalBatches = batches.length;
    
    console.log(`\n📦 Starting embedding batch ${batchNumber}/${totalBatches} (${batch.length} images, parallel slot ${activeBatches.size + 1})...`);
    
    const batchResults = [];

    try {
      // Prepare image inputs for this batch
      const imageInputs = batch.map(entry => {
        const base64Image = imageToBase64(entry.screenshotPath);
        if (!base64Image) {
          return null;
        }
        return { image: base64Image };
      }).filter(input => input !== null);

      if (imageInputs.length === 0) {
        console.warn(`  ⚠️ No valid images in batch ${batchNumber}`);
        // Add entries without embeddings
        batch.forEach(entry => {
          batchResults.push({ ...entry, embedding: null });
        });
      } else {
        console.log(`  🔄 Making Jina API call for ${imageInputs.length} images (batch ${batchNumber})...`);
        
        // Get embeddings for this batch
        const embeddings = await getJinaEmbeddings(imageInputs, apiKey);
        
        // Map embeddings back to entries
        let embeddingIndex = 0;
        batch.forEach(entry => {
          const base64Image = imageToBase64(entry.screenshotPath);
          if (base64Image && embeddingIndex < embeddings.length) {
            batchResults.push({
              ...entry,
              embedding: embeddings[embeddingIndex].embedding
            });
            console.log(`  ✅ Completed (batch ${batchNumber}): ${entry.componentName} - ${entry.testName}`);
            embeddingIndex++;
          } else {
            batchResults.push({ ...entry, embedding: null });
            console.log(`  ⚠️ No embedding (batch ${batchNumber}): ${entry.componentName} - ${entry.testName}`);
          }
        });
      }
      
    } catch (error) {
      console.error(`  ❌ Batch ${batchNumber} embedding generation failed: ${error.message}`);
      
      // Add entries without embeddings for failed batch
      batch.forEach(entry => {
        batchResults.push({ ...entry, embedding: null });
      });
    }

    console.log(`  📦 Embedding batch ${batchNumber}/${totalBatches} completed: ${batchResults.filter(r => r.embedding !== null).length}/${batch.length} successful`);
    
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
      
      const batchPromise = processSingleEmbeddingBatch(batch, index)
        .then(batchResult => {
          // Collect results
          results.push(...batchResult.results);
          
          // Remove from active set
          activeBatches.delete(batchPromise);
          completedBatches++;
          
          return batchResult;
        })
        .catch(error => {
          console.error(`❌ Embedding batch ${index + 1} failed catastrophically: ${error.message}`);
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
      console.log(`  ⏳ Waiting ${delayBetweenBatches}ms before starting next embedding batch...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  // Wait for all remaining batches to complete
  if (activeBatches.size > 0) {
    await Promise.all(Array.from(activeBatches));
  }

  // Add entries without screenshot paths
  const entriesWithoutImages = entries.filter(entry => !entry.screenshotPath);
  entriesWithoutImages.forEach(entry => {
    results.push({ ...entry, embedding: null });
  });

  const successCount = results.filter(r => r.embedding !== null).length;
  console.log(`\n📊 Parallel embedding generation completed: ${successCount}/${entriesWithImages.length} successful`);
  console.log(`  🔄 Processed ${batches.length} batches with up to ${maxConcurrentBatches} concurrent`);

  return results;
}

/**
 * Processes images in batches to avoid API rate limits (sequential)
 * @param {Array} entries - Array of test entries with screenshot paths
 * @param {string} apiKey - Jina API key
 * @param {number} batchSize - Number of images to process per batch
 * @returns {Promise<Array>} Promise that resolves to entries with embeddings
 */
async function processImagesInBatches(entries, apiKey, batchSize = 10) {
  const results = [];
  
  // Filter entries that have screenshot paths
  const entriesWithImages = entries.filter(entry => entry.screenshotPath);
  
  if (entriesWithImages.length === 0) {
    console.log('No entries with screenshot paths found.');
    return entries;
  }

  console.log(`Processing ${entriesWithImages.length} images in batches of ${batchSize}...`);

  for (let i = 0; i < entriesWithImages.length; i += batchSize) {
    const batch = entriesWithImages.slice(i, i + batchSize);
    
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(entriesWithImages.length / batchSize)}...`);
    
    // Prepare image inputs for this batch
    const imageInputs = batch.map(entry => {
      const base64Image = imageToBase64(entry.screenshotPath);
      if (!base64Image) {
        return null;
      }
      return { image: base64Image };
    }).filter(input => input !== null);

    if (imageInputs.length === 0) {
      console.warn(`No valid images in batch ${Math.floor(i / batchSize) + 1}`);
      // Add entries without embeddings
      batch.forEach(entry => {
        results.push({ ...entry, embedding: null });
      });
      continue;
    }

    try {
      // Get embeddings for this batch
      const embeddings = await getJinaEmbeddings(imageInputs, apiKey);
      
      // Map embeddings back to entries
      let embeddingIndex = 0;
      batch.forEach(entry => {
        const base64Image = imageToBase64(entry.screenshotPath);
        if (base64Image && embeddingIndex < embeddings.length) {
          results.push({
            ...entry,
            embedding: embeddings[embeddingIndex].embedding
          });
          embeddingIndex++;
        } else {
          results.push({ ...entry, embedding: null });
        }
      });
      
      // Add a small delay between batches to be respectful to the API
      if (i + batchSize < entriesWithImages.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      console.error(`Error processing batch ${Math.floor(i / batchSize) + 1}:`, error.message);
      
      // Add entries without embeddings for failed batch
      batch.forEach(entry => {
        results.push({ ...entry, embedding: null });
      });
    }
  }

  // Add entries without screenshot paths
  const entriesWithoutImages = entries.filter(entry => !entry.screenshotPath);
  entriesWithoutImages.forEach(entry => {
    results.push({ ...entry, embedding: null });
  });

  return results;
}

/**
 * Main function to generate embeddings for all story screenshots
 * @param {Array|string} storiesOrDir - Array of story objects or directory containing stories
 * @param {string} screenshotsDir - Directory containing screenshots (optional if storiesOrDir is array)
 * @param {string} apiKey - Jina API key
 * @param {number} batchSize - Batch size for API requests
 * @returns {Promise<Array>} Promise that resolves to entries with embeddings
 */
async function generateEmbeddings(storiesOrDir = './stories', screenshotsDir = './__screenshots__', apiKey, batchSize = 10, options = {}) {
  if (!apiKey) {
    throw new Error('API key is required. Please provide a Jina API key.');
  }

  let entries;
  if (Array.isArray(storiesOrDir)) {
    // Use provided story objects directly
    entries = storiesOrDir;
    console.log(`Processing ${entries.length} story entries...`);
  } else {
    // Generate story objects from directories (backward compatibility)
    console.log('Mapping stories to screenshots...');
    entries = mapStoriesToScreenshots(storiesOrDir, screenshotsDir);
    console.log(`Found ${entries.length} story entries.`);
  }
  
  // Use parallel processing if enabled and options provided
  const processingOptions = {
    batchSize,
    maxConcurrentBatches: options.maxConcurrentBatches || 3,
    enableParallel: options.enableParallel !== false,
    delayBetweenBatches: options.delayBetweenBatches || 1000,
    ...options
  };

  let entriesWithEmbeddings;
  if (processingOptions.enableParallel && processingOptions.maxConcurrentBatches > 1) {
    entriesWithEmbeddings = await processImagesInParallelBatches(entries, apiKey, processingOptions);
  } else {
    entriesWithEmbeddings = await processImagesInBatches(entries, apiKey, batchSize);
  }
  
  const successCount = entriesWithEmbeddings.filter(entry => entry.embedding !== null).length;
  console.log(`Successfully generated embeddings for ${successCount} out of ${entries.length} entries.`);
  
  return entriesWithEmbeddings;
}

// If running as a script, execute the embedding generator
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  const apiKeyIndex = args.indexOf('--api-key');
  const batchSizeIndex = args.indexOf('--batch-size');
  const helpIndex = args.indexOf('--help');
  
  if (helpIndex !== -1) {
    console.log(`
Usage: node generate-embeddings.js [options] [storiesDir] [screenshotsDir]

Options:
  --api-key <key>       Jina API key (required)
  --batch-size <size>   Number of images to process per batch (default: 10)
  --help               Show this help message

Examples:
  node generate-embeddings.js --api-key your_api_key_here
  node generate-embeddings.js --api-key your_key --batch-size 5 ./stories ./__screenshots__
    `);
    process.exit(0);
  }
  
  if (apiKeyIndex === -1 || apiKeyIndex + 1 >= args.length) {
    console.error('Error: --api-key is required');
    console.log('Use --help for usage information');
    process.exit(1);
  }
  
  const apiKey = args[apiKeyIndex + 1];
  const batchSize = batchSizeIndex !== -1 && batchSizeIndex + 1 < args.length 
    ? parseInt(args[batchSizeIndex + 1]) 
    : 10;
  
  // Filter out option arguments to get positional arguments
  const positionalArgs = args.filter((arg, index) => {
    return !arg.startsWith('--') && 
           index !== apiKeyIndex + 1 && 
           index !== batchSizeIndex + 1;
  });
  
  const storiesDir = positionalArgs[0] || './stories';
  const screenshotsDir = positionalArgs[1] || './__screenshots__';
  
  generateEmbeddings(storiesDir, screenshotsDir, apiKey, batchSize)
    .then(results => {
      console.log(JSON.stringify(results, null, 2));
    })
    .catch(error => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}

module.exports = {
  generateEmbeddings,
  imageToBase64,
  getJinaEmbeddings,
  processImagesInBatches,
  processImagesInParallelBatches
};