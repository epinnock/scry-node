const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

/**
 * Reads the component inspector prompt from file
 * @returns {string} The prompt content
 */
function loadComponentInspectorPrompt() {
  try {
    const promptPath = path.join(__dirname, '..', 'prompts', 'componentinspector.prompt');
    return fs.readFileSync(promptPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load prompt file: ${error.message}`);
  }
}

/**
 * Converts an image file to base64 string
 * @param {string} imagePath - Path to the image file
 * @returns {string} Base64 encoded string with data URL prefix
 */
function imageToBase64DataUrl(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }
    
    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    
    // Determine MIME type based on extension
    let mimeType = 'image/jpeg'; // default
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.webp') mimeType = 'image/webp';
    
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    throw new Error(`Error reading image file: ${error.message}`);
  }
}

/**
 * Parses XML content and converts to JSON
 * @param {string} xmlContent - XML string to parse
 * @returns {Object} Parsed JSON object
 */
function parseXmlToJson(xmlContent) {
  try {
    // Remove XML declaration and normalize whitespace
    const cleanXml = xmlContent
      .replace(/<\?xml[^>]*\?>/i, '')
      .replace(/^\s+|\s+$/g, '')
      .trim();

    const result = {};

    // Extract description
    const descriptionMatch = cleanXml.match(/<description>([\s\S]*?)<\/description>/i);
    if (descriptionMatch) {
      result.description = descriptionMatch[1].trim();
    }

    // Extract tags
    const tagsMatch = cleanXml.match(/<tags>([\s\S]*?)<\/tags>/i);
    if (tagsMatch) {
      const tagsContent = tagsMatch[1];
      const tagMatches = tagsContent.match(/<tag>(.*?)<\/tag>/gi);
      result.tags = tagMatches ? tagMatches.map(tag => 
        tag.replace(/<\/?tag>/gi, '').trim()
      ) : [];
    }

    // Extract search queries
    const queriesMatch = cleanXml.match(/<search-queries>([\s\S]*?)<\/search-queries>/i);
    if (queriesMatch) {
      const queriesContent = queriesMatch[1];
      const queryMatches = queriesContent.match(/<query>(.*?)<\/query>/gi);
      result.searchQueries = queryMatches ? queryMatches.map(query => 
        query.replace(/<\/?query>/gi, '').trim()
      ) : [];
    }

    return result;
  } catch (error) {
    throw new Error(`Failed to parse XML: ${error.message}`);
  }
}

/**
 * Creates a batch prompt for analyzing multiple components
 * @param {number} componentCount - Number of components to analyze
 * @returns {string} Modified prompt for batch processing
 */
function createBatchPrompt(componentCount) {
  const basePrompt = loadComponentInspectorPrompt();
  
  const batchInstructions = `

## BATCH PROCESSING INSTRUCTIONS

You will analyze ${componentCount} UI component screenshots provided in sequence.

**CRITICAL**: Provide exactly ${componentCount} component documentation blocks, numbered from 1 to ${componentCount}.

### Required Output Format:

\`\`\`xml
<batch-analysis>
<component-1>
  <description>[description for component 1]</description>
  <tags>
    <tag>Component Name</tag>
    <!-- 8-15 total tags -->
  </tags>
  <search-queries>
    <query>search query 1</query>
    <!-- 5-7 total queries -->
  </search-queries>
</component-1>

<component-2>
  <description>[description for component 2]</description>
  <tags>
    <tag>Component Name</tag>
    <!-- 8-15 total tags -->
  </tags>
  <search-queries>
    <query>search query 1</query>
    <!-- 5-7 total queries -->
  </search-queries>
</component-2>

<!-- Continue for all ${componentCount} components -->
</batch-analysis>
\`\`\`

**IMPORTANT**:
- Analyze each component independently
- Maintain the same quality standards as single component analysis
- Component numbers must match the image order exactly (1st image = component-1, etc.)
- Each component must have complete documentation
`;

  return basePrompt + batchInstructions;
}

/**
 * Parses batch XML response into individual component results
 * @param {string} xmlResponse - XML response from OpenAI
 * @param {Array} stories - Original story objects
 * @param {Object} options - Processing options
 * @returns {Array} Array of individual component analysis results
 */
function parseBatchResponse(xmlResponse, stories, options = {}) {
  try {
    const results = [];
    
    // Extract each component block using regex
    const componentPattern = /<component-(\d+)>([\s\S]*?)<\/component-\1>/gi;
    const componentMatches = [...xmlResponse.matchAll(componentPattern)];
    
    // Parse each component
    for (let i = 0; i < stories.length; i++) {
      const story = stories[i];
      const componentMatch = componentMatches.find(match =>
        parseInt(match[1]) === i + 1
      );
      
      if (!componentMatch) {
        throw new Error(`Missing component ${i + 1} in batch response`);
      }
      
      const componentXml = componentMatch[2];
      
      // Parse individual component using existing parser
      const componentResult = parseXmlToJson(`<component-documentation>${componentXml}</component-documentation>`);
      
      // Add metadata
      componentResult.metadata = {
        imagePath: story.screenshotPath,
        model: options.model || 'gpt-5-mini',
        timestamp: new Date().toISOString(),
        batchIndex: i + 1,
        rawXmlResponse: componentXml
      };
      
      // Add story data
      if (story) {
        componentResult.storyData = {
          filepath: story.filepath,
          componentName: story.componentName,
          testName: story.testName,
          location: story.location,
          storyTitle: story.storyTitle
        };
      }
      
      results.push(componentResult);
    }
    
    return results;
  } catch (error) {
    throw new Error(`Failed to parse batch response: ${error.message}`);
  }
}

/**
 * Analyzes multiple component images using a single OpenAI API call
 * @param {Array} stories - Array of story objects with screenshotPath
 * @param {string} apiKey - OpenAI API key
 * @param {Object} options - Additional options
 * @returns {Promise<Array>} Array of analysis results in same order as input
 */
async function batchInspectMultipleComponents(stories, apiKey, options = {}) {
  const {
    model = 'gpt-5-mini',
    maxTokens = 1500 * stories.length, // Scale tokens with batch size
    temperature = 1
  } = options;

  // Initialize OpenAI client
  const openai = new OpenAI({ apiKey });

  // Load modified prompt for multiple components
  const batchPrompt = createBatchPrompt(stories.length);

  // Build content array with text prompt + all images
  const content = [
    {
      type: "text",
      text: batchPrompt + `\n\nAnalyze these ${stories.length} UI component screenshots and provide numbered documentation for each.`
    }
  ];

  // Add each image to the content array
  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    
    // Validate screenshot path exists
    if (!story.screenshotPath || !fs.existsSync(story.screenshotPath)) {
      throw new Error(`Screenshot not found for ${story.componentName}: ${story.screenshotPath}`);
    }
    
    const base64Image = imageToBase64DataUrl(story.screenshotPath);
    
    content.push({
      type: "image_url",
      image_url: {
        url: base64Image,
        detail: "high"
      }
    });
  }

  try {
    console.log(`🔍 Batch analyzing ${stories.length} component images`);
    stories.forEach((story, i) => {
      console.log(`    [${i + 1}] ${story.componentName} - ${story.testName}`);
    });

    // Build request options
    const requestOptions = {
      model: model,
      max_completion_tokens: maxTokens,
      messages: [{ role: "user", content }]
    };

    // Only add temperature if it's not the default value
    if (temperature !== 1) {
      requestOptions.temperature = temperature;
    }

    // Single API call with all images
    const response = await openai.chat.completions.create(requestOptions);

    const xmlResponse = response.choices[0].message.content;
    
    if (!xmlResponse) {
      throw new Error('No response content received from OpenAI API');
    }

    console.log('✅ Received batch response from OpenAI');

    // Parse response into individual component results
    const results = parseBatchResponse(xmlResponse, stories, options);
    
    console.log(`✅ Parsed ${results.length} component results from batch response`);
    
    return results;
    
  } catch (error) {
    throw new Error(`OpenAI batch API error: ${error.message}`);
  }
}

/**
 * Analyzes a component image using OpenAI API
 * @param {string|Object} input - Path to image file OR story object with screenshotPath
 * @param {string} apiKey - OpenAI API key
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Analysis result in JSON format
 */
async function inspectComponent(input, apiKey, options = {}) {
  const {
    model = 'gpt-5-mini',
    maxTokens = 1500,
    temperature = 1
  } = options;

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: apiKey
  });

  // Handle both string path and story object input

  //Update request we no longer pass a string in
  let imagePath, storyData = null;
  if (typeof input === 'string') {
    imagePath = input;
  } else if (input && input.screenshotPath) {
    imagePath = input.screenshotPath;
    storyData = input;
  } else {
    throw new Error('Input must be either an image path string or a story object with screenshotPath');
  }

  // Load the prompt
  const prompt = loadComponentInspectorPrompt();

  // Convert image to base64
  const base64Image = imageToBase64DataUrl(imagePath);

  try {
    console.log(`🔍 Analyzing component image: ${imagePath}`);
    if (storyData) {
      console.log(`    Component: ${storyData.componentName} - Story: ${storyData.testName}`);
    }
    
    // Build request options - only include temperature if it's not the default (1)
    const requestOptions = {
      model: model,
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt + "\n\nPlease analyze this UI component screenshot and provide the documentation in the specified XML format."
            },
            {
              type: "image_url",
              image_url: {
                url: base64Image
              }
            }
          ]
        }
      ]
    };

    // Only add temperature if it's not the default value (some models only support default)
    if (temperature !== 1) {
      try {
        requestOptions.temperature = temperature;
      } catch (error) {
        console.warn(`Warning: Temperature ${temperature} not supported by model ${model}, using default`);
      }
    }

    const response = await openai.chat.completions.create(requestOptions);

    const xmlResponse = response.choices[0].message.content;
    
    if (!xmlResponse) {
      throw new Error('No response content received from OpenAI API');
    }

    console.log('✅ Received response from OpenAI');
    
    // Parse XML to JSON
    const jsonResult = parseXmlToJson(xmlResponse);
    
    // Add metadata
    jsonResult.metadata = {
      imagePath: imagePath,
      model: model,
      timestamp: new Date().toISOString(),
      rawXmlResponse: xmlResponse
    };

    // If we have story data, include it in the result
    if (storyData) {
      jsonResult.storyData = {
        filepath: storyData.filepath,
        componentName: storyData.componentName,
        testName: storyData.testName,
        location: storyData.location,
        storyTitle: storyData.storyTitle
      };
    }

    return jsonResult;
    
  } catch (error) {
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed configuration
 */
function parseArguments(args) {
  const config = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--image':
      case '-i':
        config.imagePath = nextArg;
        i++;
        break;
        
      case '--api-key':
      case '-k':
        config.apiKey = nextArg;
        i++;
        break;
        
      case '--model':
      case '-m':
        config.model = nextArg;
        i++;
        break;
        
      case '--output':
      case '-o':
        config.outputFile = nextArg;
        i++;
        break;
        
      case '--max-tokens':
      case '--max-completion-tokens':
        config.maxTokens = parseInt(nextArg);
        i++;
        break;
        
      case '--temperature':
        config.temperature = parseFloat(nextArg);
        i++;
        break;
        
      case '--pretty':
        config.prettyOutput = true;
        break;
        
      case '--help':
      case '-h':
        config.showHelp = true;
        break;
        
      default:
        // If no flag specified, treat as image path
        if (!arg.startsWith('--') && !arg.startsWith('-') && !config.imagePath) {
          config.imagePath = arg;
        }
        break;
    }
  }
  
  return config;
}

/**
 * Display help information
 */
function showHelp() {
  console.log(`
🔍 Component Inspector Tool

Analyzes UI component screenshots using OpenAI's vision API and generates standardized documentation.

USAGE:
  node scripts/inspect-component.js [image-path] [options]

REQUIRED:
  --image, -i <path>      Path to the component image file
  --api-key, -k <key>     OpenAI API key

OPTIONS:
  --model, -m <model>     OpenAI model to use (default: gpt-5-mini)
  --output, -o <file>     Output file for results (default: stdout)
  --max-tokens <number>   Maximum completion tokens for response (default: 1500)
  --max-completion-tokens <number>  Alias for --max-tokens
  --temperature <number>  Temperature for AI response (default: 1)
  --pretty                Pretty-print JSON output
  --help, -h              Show this help message

EXAMPLES:
  # Basic usage
  node scripts/inspect-component.js ./example.png --api-key sk-...

  # With custom model and output file
  node scripts/inspect-component.js \\
    --image ./screenshots/button-primary.png \\
    --api-key sk-... \\
    --model gpt-5-mini \\
    --output button-analysis.json \\
    --pretty

  # Using environment variable for API key
  OPENAI_API_KEY=sk-... node scripts/inspect-component.js ./component.png

SUPPORTED IMAGE FORMATS:
  - PNG (.png)
  - JPEG (.jpg, .jpeg)
  - GIF (.gif)
  - WebP (.webp)
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
  
  // Check for API key in environment if not provided
  if (!config.apiKey) {
    config.apiKey = process.env.OPENAI_API_KEY;
  }
  
  // Validate required options
  if (!config.imagePath) {
    console.error('❌ Error: Image path is required');
    console.log('Use --help for usage information');
    process.exit(1);
  }
  
  if (!config.apiKey) {
    console.error('❌ Error: OpenAI API key is required');
    console.log('Provide via --api-key flag or OPENAI_API_KEY environment variable');
    console.log('Use --help for usage information');
    process.exit(1);
  }
  
  // Run the inspection
  const options = {
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature
  };
  
  inspectComponent(config.imagePath, config.apiKey, options)
    .then(result => {
      const output = config.prettyOutput 
        ? JSON.stringify(result, null, 2)
        : JSON.stringify(result);
      
      if (config.outputFile) {
        fs.writeFileSync(config.outputFile, output);
        console.log(`📄 Analysis saved to: ${config.outputFile}`);
      } else {
        console.log('\n📊 ANALYSIS RESULT:');
        console.log(output);
      }
    })
    .catch(error => {
      console.error('❌ Analysis failed:', error.message);
      process.exit(1);
    });
}

module.exports = {
  inspectComponent,
  batchInspectMultipleComponents,
  parseXmlToJson,
  loadComponentInspectorPrompt,
  imageToBase64DataUrl,
  parseArguments,
  createBatchPrompt,
  parseBatchResponse
};