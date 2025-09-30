const { MilvusClient, DataType, sleep } = require("@zilliz/milvus2-sdk-node")

/**
 * Vector database utilities for inserting Storybook analysis data
 */
class VectorUtils {
  constructor(options = {}) {
    this.address = options.address || process.env.MILVUS_ADDRESS || "YOUR_CLUSTER_ENDPOINT";
    this.token = options.token || process.env.MILVUS_TOKEN || "YOUR_CLUSTER_TOKEN";
    this.collectionName = options.collectionName || "scry-upload-api-key";
    this.projectId = options.projectId || "default-project";
    this.client = null;
  }

  /**
   * Initialize connection to Milvus
   */
  async connect() {
    if (!this.client) {
      this.client = new MilvusClient({
        address: this.address,
        token: this.token
      });
    }
    return this.client;
  }

  /**
   * Pad or truncate vector to specified dimensions
   * @param {number[]} vector - Input vector
   * @param {number} targetDim - Target dimensions
   * @returns {number[]} Padded or truncated vector
   */
  padVector(vector, targetDim) {
    if (!vector || !Array.isArray(vector)) {
      return new Array(targetDim).fill(0);
    }
    
    if (vector.length === targetDim) {
      return vector;
    } else if (vector.length > targetDim) {
      // Truncate if vector is longer
      return vector.slice(0, targetDim);
    } else {
      // Pad with zeros if vector is shorter
      const padded = [...vector];
      while (padded.length < targetDim) {
        padded.push(0);
      }
      return padded;
    }
  }

  
  /**
   * Setup collection with multi-vector schema
   * @param {Object} options - Setup options
   * @returns {Promise<Object>} Setup result
   */
  async setupCollection(options = {}) {
    await this.connect();

    const collectionName = options.collectionName || this.collectionName;
    
    try {
      // Check if collection exists
      const hasCollection = await this.client.hasCollection({
        collection_name: collectionName
      });

      if (hasCollection.value) {
        console.log(`✅ Collection ${collectionName} already exists`);
        return { exists: true, collectionName };
      }

      console.log(`🔧 Creating multi-vector collection: ${collectionName}`);

      // Define multi-vector schema
      const schema = [
        {
          name: 'primary_key',
          data_type: DataType.Int64,
          is_primary_key: true,
          description: 'Primary key field'
        },
        {
          name: 'text_dense',
          data_type: DataType.FloatVector,
          dim: 2048,
          description: 'Dense text embeddings (2048 dimensions)'
        },
        {
          name: 'image_dense', 
          data_type: DataType.FloatVector,
          dim: 2048,
          description: 'Dense image embeddings (2048 dimensions)'
        },
        {
          name: 'text',
          data_type: DataType.VarChar,
          max_length: 65535,
          description: 'Searchable text content'
        },
        {
          name: 'component_name',
          data_type: DataType.VarChar,
          max_length: 256,
          description: 'Component name'
        },
        {
          name: 'project_id',
          data_type: DataType.VarChar,
          max_length: 256,
          description: 'Project identifier'
        },
        {
          name: 'timestamp',
          data_type: DataType.Int64,
          description: 'Timestamp'
        },
        {
          name: 'json_content',
          data_type: DataType.JSON,
          description: 'Additional metadata as JSON'
        }
      ];

      // Create collection
      const createResult = await this.client.createCollection({
        collection_name: collectionName,
        fields: schema,
        description: 'Multi-vector collection for hybrid search'
      });

      console.log('📋 Collection created:', createResult);

      // Create indexes for vector fields
      console.log('🔍 Creating indexes...');

      // Index for text_dense
      await this.client.createIndex({
        collection_name: collectionName,
        field_name: 'text_dense',
        index_type: 'IVF_FLAT',
        metric_type: 'L2',
        params: { nlist: 1024 }
      });

      // Index for image_dense
      await this.client.createIndex({
        collection_name: collectionName,
        field_name: 'image_dense',
        index_type: 'IVF_FLAT',
        metric_type: 'L2',
        params: { nlist: 1024 }
      });

      console.log('✅ Multi-vector collection setup completed');

      return { 
        created: true, 
        collectionName,
        schema: schema.map(f => ({ name: f.name, type: f.data_type, dim: f.dim }))
      };

    } catch (error) {
      console.error('❌ Error setting up collection:', error.message);
      throw error;
    }
  }

  /**
   * Transform story data to multi-vector database format
   * @param {Object} storyData - Story analysis data
   * @param {number} index - Index for primary key generation
   * @returns {Object} Formatted data for multi-vector DB
   */
  transformStoryData(storyData, index = 0) {
    const timestamp = Date.now();
    
    const {image_embedding, textEmbedding, searchableText, ...jsonObject} = storyData;

    return {
      primary_key: timestamp + index, // Unique primary key
      text_embedding: this.padVector(textEmbedding, 2048),
      image_embedding: this.padVector(image_embedding, 2048), 
      searchable_text: (searchableText || '').substring(0, 65535), // Truncate if too long
      json_content: jsonObject,
      project_id: this.projectId,
      timestamp: timestamp,
      component_name: storyData.componentName || 'unknown'
    };
  }

  /**
   * Insert story data into vector database
   * @param {Object[]} storyDataArray - Array of story analysis objects
   * @param {Object} options - Insert options
   * @returns {Promise<Object>} Insert result
   */
  async insertStoryData(storyDataArray, options = {}) {
    if (!Array.isArray(storyDataArray) || storyDataArray.length === 0) {
      throw new Error('storyDataArray must be a non-empty array');
    }

    await this.connect();

    const batchSize = options.batchSize || 100;
    const results = [];

    console.log(`🔄 Inserting ${storyDataArray.length} story entries into vector database ${this.collectionName} ...`);

    // Process in batches
    for (let i = 0; i < storyDataArray.length; i += batchSize) {
      const batch = storyDataArray.slice(i, i + batchSize);
      const transformedData = batch.map((story, index) => 
        this.transformStoryData(story, i + index)
      );

      try {
        console.log(`📝 Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(storyDataArray.length / batchSize)} (${batch.length} items)`);
        
        const result = await this.client.insert({
          collection_name: this.collectionName,
          data: transformedData
        });
        console.log(result);
        results.push(result);
        console.log(`✅ Batch inserted successfully: ${result.insert_cnt} records`);

      } catch (error) {
        console.error(`❌ Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error.message);
        
        if (options.continueOnError) {
          results.push({ error: error.message, batch: i / batchSize + 1 });
          continue;
        } else {
          throw error;
        }
      }
    }

    const totalInserted = results
      .filter(r => !r.error)
      .reduce((sum, r) => sum + (r.insert_cnt || 0), 0);

    console.log(`🎉 Insert completed: ${totalInserted} total records inserted`);

    return {
      totalRecords: storyDataArray.length,
      totalInserted: totalInserted,
      batches: results.length,
      results: results
    };
  }

  /**
   * Close connection
   */
  async close() {
    if (this.client) {
      await this.client.closeConnection();
      this.client = null;
    }
  }
}

/**
 * Convenience function to insert story data
 * @param {Object[]} storyDataArray - Array of story analysis objects
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Insert result
 */
 async function insertStoryDataToVectorDB(storyDataArray, options = {}) {
  const vectorUtils = new VectorUtils(options);
  
  try {
    const result = await vectorUtils.insertStoryData(storyDataArray, options);
    return result;
  } finally {
    await vectorUtils.close();
  }
}

/**
 * Convenience function to setup collection
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Setup result
 */
 async function setupVectorDBCollection(options = {}) {
  const vectorUtils = new VectorUtils(options);
  
  try {
    const result = await vectorUtils.setupCollection(options);
    return result;
  } finally {
    await vectorUtils.close();
  }
}

module.exports = {
  VectorUtils,
  insertStoryDataToVectorDB,
  setupVectorDBCollection
};

// Example usage
if (require.main === module) {
  // Example story data
  const exampleStoryData = [
    {
      "filepath": "stories/Button.stories.ts",
      "componentName": "Button",
      "testName": "Primary",
      "location": {
        "startLine": 29,
        "endLine": 34
      },
      "storyTitle": "Example/Button",
      "screenshotPath": "__screenshots__/Example/Button/Primary.png",
      "image_embedding": new Array(1024).fill(0).map(() => Math.random()),
      "inspection": {
        "description": "This is a button component intended to trigger a primary action when clicked.",
        "tags": ["Button", "Primary", "Small", "Purple"],
        "searchQueries": ["small purple pill button", "primary filled rounded button"],
        "metadata": {
          "imagePath": "__screenshots__/Example/Button/Primary.png",
          "model": "gpt-5-mini",
          "timestamp": "2025-08-31T22:45:36.294Z"
        }
      },
      "searchableText": "react component user interface element",
      "textEmbedding": new Array(1024).fill(0).map(() => Math.random())
    }
  ];

  // Setup and insert example
  async function runExample() {
    const vectorUtils = new VectorUtils({
      address: process.env.MILVUS_ADDRESS,
      token: process.env.MILVUS_TOKEN,
      projectId: "storybook-demo"
    });

    try {
      // Setup collection
      await vectorUtils.setupCollection();
      
      // Insert data
      const result = await vectorUtils.insertStoryData(exampleStoryData);
      console.log('Insert result:', result);
      
    } catch (error) {
      console.error('Error:', error);
    } finally {
      await vectorUtils.close();
    }
  }

  // Uncomment to run example
  // runExample();
}
