const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

/**
 * R2Uploader class for uploading files to Cloudflare R2 storage
 */
class R2Uploader {
  constructor(config = {}) {
    // Configuration with environment variable fallbacks
    this.accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
    this.accessKeyId = config.accessKeyId || process.env.CLOUDFLARE_ACCESS_KEY_ID;
    this.secretAccessKey = config.secretAccessKey || process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
    this.bucketName = config.bucketName || process.env.R2_BUCKET_NAME;
    this.r2Endpoint = config.baseR2Path || process.env.R2_BASE_PATH;
    
    // Validate required configuration
    if (!this.accountId || !this.accessKeyId || !this.secretAccessKey || !this.bucketName) {
      throw new Error('Missing required configuration. Please provide accountId, accessKeyId, secretAccessKey, and bucketName either as parameters or environment variables.');
    }

    // Initialize S3 client configured for Cloudflare R2
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: this.r2Endpoint,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey
      },
    });
     console.log('Created S3 Client');
    // R2 public domain for constructing URLs
    this.publicDomain = config.publicDomain || process.env.R2_PUBLIC_DOMAIN;
  }

  /**
   * Upload a single file to R2
   * @param {string} filePath - Local file path to upload
   * @param {string} [destinationPath] - Destination path in R2 bucket (optional)
   * @returns {Promise<string>} Public URL of the uploaded file
   */
  async uploadFile(filePath, destinationPath = null) {
    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Generate destination path if not provided
      if (!destinationPath) {
        // Use relative path from project root
        const projectRoot = process.cwd();
        destinationPath = path.relative(projectRoot, filePath);
      }

      // Read file content
      const fileContent = fs.readFileSync(filePath);
      
      // Determine content type based on file extension
      const contentType = this._getContentType(filePath);

      // Create upload command
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: destinationPath,
        Body: fileContent,
        ContentType: contentType,
      });

      console.log(`sending command ${command}`)
      // Execute upload
      await this.s3Client.send(command);
      console.log(`successfully sent command ${command}`)

      // Construct and return public URL
      const publicUrl = this._constructPublicUrl(destinationPath);
      
      console.log(`✅ Uploaded: ${filePath} → ${publicUrl}`);
      return publicUrl;

    } catch (error) {
      console.error(`❌ Failed to upload ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * Upload multiple files to R2 (sequential - for backward compatibility)
   * @param {string[]} filePaths - Array of local file paths to upload
   * @param {string} [baseR2Path=''] - Base path in R2 bucket for all uploads
   * @returns {Promise<Array<{originalPath: string, r2Url: string}>>} Array of upload results
   */
  async uploadFiles(filePaths, baseR2Path = '') {
    const results = [];
    const errors = [];

    console.log(`📤 Starting sequential upload of ${filePaths.length} files...`);

    for (const filePath of filePaths) {
      try {
        // Construct destination path with base R2 path
        let destinationPath = null;
        if (baseR2Path) {
          const fileName = path.basename(filePath);
          destinationPath = path.posix.join(baseR2Path, fileName);
        }

        const r2Url = await this.uploadFile(filePath, destinationPath);
        
        results.push({
          originalPath: filePath,
          r2Url: r2Url
        });

      } catch (error) {
        const errorInfo = {
          originalPath: filePath,
          error: error.message
        };
        errors.push(errorInfo);
        
        console.warn(`⚠️  Skipping ${filePath} due to error: ${error.message}`);
      }
    }

    // Log summary
    console.log(`📊 Sequential upload complete: ${results.length} successful, ${errors.length} failed`);
    
    if (errors.length > 0) {
      console.warn('Failed uploads:', errors);
    }

    return results;
  }

  /**
   * Upload multiple files to R2 with parallel batch processing
   * @param {string[]} filePaths - Array of local file paths to upload
   * @param {string} [baseR2Path=''] - Base path in R2 bucket for all uploads
   * @param {Object} options - Upload options
   * @param {number} [options.batchSize=5] - Files per batch
   * @param {number} [options.maxConcurrentBatches=3] - Max concurrent batches
   * @param {boolean} [options.enableParallel=true] - Enable parallel processing
   * @param {number} [options.delayBetweenBatches=500] - Delay between batch starts
   * @returns {Promise<Array<{originalPath: string, r2Url: string}>>} Array of upload results
   */
  async uploadFilesInParallel(filePaths, baseR2Path = '', options = {}) {
    const {
      batchSize = 5,
      maxConcurrentBatches = 3,
      enableParallel = true,
      delayBetweenBatches = 500
    } = options;

    if (!enableParallel || maxConcurrentBatches <= 1) {
      // Fall back to sequential processing
      return this.uploadFiles(filePaths, baseR2Path);
    }

    console.log(`📤 Starting parallel upload of ${filePaths.length} files...`);
    console.log(`🚀 Using parallel R2 upload (max ${maxConcurrentBatches} concurrent batches of ${batchSize} files)`);

    // Create batches
    const batches = [];
    for (let i = 0; i < filePaths.length; i += batchSize) {
      batches.push(filePaths.slice(i, i + batchSize));
    }

    const results = [];
    const errors = [];

    // Process batches with controlled concurrency
    let batchQueue = batches.map((batch, index) => ({ batch, index }));
    let activeBatches = new Set();
    let completedBatches = 0;

    /**
     * Process a single upload batch
     * @param {Array} batch - Files in this batch
     * @param {number} batchIndex - Index of the batch
     * @returns {Promise<Object>} Batch results
     */
    const processSingleUploadBatch = async (batch, batchIndex) => {
      const batchNumber = batchIndex + 1;
      const totalBatches = batches.length;
      
      console.log(`\n📦 Starting R2 upload batch ${batchNumber}/${totalBatches} (${batch.length} files, parallel slot ${activeBatches.size + 1})...`);
      
      const batchResults = [];
      const batchErrors = [];

      // Upload all files in this batch concurrently
      const uploadPromises = batch.map(async (filePath) => {
        try {
          // Construct destination path with base R2 path
          let destinationPath = null;
          if (baseR2Path) {
            const fileName = path.basename(filePath);
            destinationPath = path.posix.join(baseR2Path, fileName);
          }

          const r2Url = await this.uploadFile(filePath, destinationPath);
          
          console.log(`  ✅ Uploaded (batch ${batchNumber}): ${path.basename(filePath)}`);
          
          return {
            originalPath: filePath,
            r2Url: r2Url
          };

        } catch (error) {
          console.error(`  ❌ Failed (batch ${batchNumber}): ${path.basename(filePath)} - ${error.message}`);
          
          return {
            originalPath: filePath,
            error: error.message
          };
        }
      });

      // Wait for all uploads in this batch to complete
      const batchUploadResults = await Promise.all(uploadPromises);

      // Separate successful uploads from errors
      batchUploadResults.forEach(result => {
        if (result.error) {
          batchErrors.push(result);
        } else {
          batchResults.push(result);
        }
      });

      console.log(`  📦 R2 upload batch ${batchNumber}/${totalBatches} completed: ${batchResults.length}/${batch.length} successful`);
      
      return {
        batchIndex,
        results: batchResults,
        errors: batchErrors
      };
    };

    // Process batches with controlled concurrency
    while (completedBatches < batches.length) {
      // Start new batches up to the concurrency limit
      while (activeBatches.size < maxConcurrentBatches && batchQueue.length > 0) {
        const { batch, index } = batchQueue.shift();
        
        const batchPromise = processSingleUploadBatch(batch, index)
          .then(batchResult => {
            // Collect results and errors
            results.push(...batchResult.results);
            errors.push(...batchResult.errors);
            
            // Remove from active set
            activeBatches.delete(batchPromise);
            completedBatches++;
            
            return batchResult;
          })
          .catch(error => {
            console.error(`❌ R2 upload batch ${index + 1} failed catastrophically: ${error.message}`);
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
        console.log(`  ⏳ Waiting ${delayBetweenBatches}ms before starting next R2 upload batch...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    // Wait for all remaining batches to complete
    if (activeBatches.size > 0) {
      await Promise.all(Array.from(activeBatches));
    }

    // Log summary
    console.log(`\n📊 Parallel R2 upload completed: ${results.length} successful, ${errors.length} failed`);
    console.log(`  🔄 Processed ${batches.length} batches with up to ${maxConcurrentBatches} concurrent`);
    
    if (errors.length > 0) {
      console.warn('Failed uploads:', errors);
    }

    return results;
  }

  /**
   * Get content type based on file extension
   * @param {string} filePath - File path
   * @returns {string} MIME type
   * @private
   */
  _getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.zip': 'application/zip',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Construct public URL for uploaded file
   * @param {string} key - File key in R2 bucket
   * @returns {string} Public URL
   * @private
   */
  _constructPublicUrl(key) {
    if (this.publicDomain) {
      return `https://${this.publicDomain}/${key}`;
    }
    
    // Default R2 public URL format (if public domain is configured)
    return `https://${this.bucketName}.${this.accountId}.r2.cloudflarestorage.com/${key}`;
  }
}

module.exports = R2Uploader;