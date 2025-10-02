# Storybook Analysis & Utility Scripts

This directory contains Node.js scripts for analyzing Storybook stories, mapping screenshots, generating visual embeddings using AI, and utility scripts for file operations. The scripts work together to provide comprehensive metadata and visual analysis of your Storybook components, plus additional utilities for cloud storage operations.

## Story File Auto-Detection

The scripts now automatically detect `.stories.*` files anywhere in your project! You no longer need to specify a stories directory - the system will intelligently search for story files with the following features:

### Supported File Patterns
- `.stories.ts`
- `.stories.tsx`
- `.stories.js`
- `.stories.jsx`
- `.stories.mjs`
- `.stories.cjs`

### Auto-Detection Features
- **Automatic Discovery**: Searches the entire project for story files
- **Intelligent Exclusions**: Automatically skips common directories like:
  - `node_modules`
  - `.git`
  - `dist`
  - `build`
  - `coverage`
  - `.next`
  - `out`
  - `__screenshots__`
  - `.storybook`
  - `public`
  - `static`
- **Flexible Location**: Story files can be anywhere in your project structure
- **Depth Limiting**: Searches up to 5 levels deep by default for performance

### Usage

#### Automatic Mode (Recommended)
Simply run the scripts without specifying a stories directory:

```bash
# Auto-detect story files
node newscripts/crawl-stories.cjs

# Auto-detect and map to screenshots
node newscripts/map-screenshots.cjs

# Full analysis with auto-detection
node newscripts/analyze-storybook.cjs --storybook-url https://your-storybook.vercel.app/
```

#### Manual Directory Mode
You can still specify a directory if needed:

```bash
# Use specific directory
node newscripts/crawl-stories.cjs ./src/components

# With environment variable
STORIES_DIR=./src/stories node newscripts/analyze-storybook.cjs
```

## Overview

### Scripts

**Storybook Analysis:**
1. **[`analyze-storybook.js`](#analyze-storybookjs)** - 🚀 **All-in-one script** for complete Storybook analysis pipeline
2. **[`crawl-stories.js`](#crawl-storiesjs)** - Crawls Storybook story files and extracts metadata
3. **[`map-screenshots.js`](#map-screenshotsjs)** - Maps story entries to their corresponding screenshots
4. **[`generate-embeddings.js`](#generate-embeddingsjs)** - Generates AI embeddings for screenshot images using Jina API
5. **[`inspect-component.js`](#inspect-componentjs)** - 🧠 **AI-powered component analysis** using OpenAI's vision API
6. **[`batch-inspect-components.js`](#batch-inspect-componentsjs)** - Batch processes multiple component images for AI analysis
7. **[`inspect-stories.js`](#inspect-storiesjs)** - 🔄 **Pipeline integration** for analyzing story objects with component documentation

**Utility Scripts:**
8. **[`r2-upload.js`](#r2-uploadjs)** - 📤 **Cloudflare R2 uploader** for batch file uploads to cloud storage

### Prerequisites

- Node.js (v14 or higher)
- Storybook project with story files (`.stories.ts` or `.stories.tsx`)
- Screenshots directory (typically `__screenshots__`) for visual analysis
- Jina API key for embedding generation
- OpenAI API key for component analysis and documentation generation

### Configuration

#### Environment Variables (.env files)

The analyze-storybook script now supports configuration via `.env` files, making it easier to manage API keys and default settings without exposing them in command-line arguments.

**Setup:**
1. Copy `.env.example` to `.env` in your project root
2. Fill in your actual values (API keys, credentials, etc.)
3. Run the script with minimal CLI arguments

**Precedence Order:**
1. **CLI arguments** (highest priority) - override everything
2. **Environment variables** (medium priority) - from `.env` file or system
3. **Hardcoded defaults** (lowest priority) - fallback values

**Example .env file:**
```bash
# API Keys
JINA_API_KEY=jina_your_api_key_here
OPENAI_API_KEY=sk-your_openai_key_here

# Basic Configuration
STORYBOOK_URL=https://your-storybook.vercel.app/
STORIES_DIR=./stories
SCREENSHOTS_DIR=./__screenshots__
BATCH_SIZE=10

# Cloudflare R2 Configuration
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_ACCESS_KEY_ID=your_r2_access_key_id
CLOUDFLARE_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=your-r2-bucket

# Milvus Vector Database
MILVUS_ADDRESS=your_milvus_endpoint
MILVUS_TOKEN=your_milvus_token

# Storycap Options
CHROMIUM_PATH=/snap/chromium/current/usr/lib/chromium-browser/chrome
```

**Benefits:**
- Keep sensitive API keys out of command history
- Set project-specific defaults once
- Simplify CLI commands
- Easy team sharing via `.env.example`
- Override individual settings when needed

## Scripts Documentation

### `analyze-storybook.js`

🚀 **All-in-one script** that handles the complete Storybook analysis pipeline: screenshot capture using storycap, story crawling, screenshot mapping, AI embedding generation, and LLM component inspection.

#### Usage

```bash
# Complete analysis with .env configuration (recommended)
node scripts/analyze-storybook.js

# Override specific settings via CLI
node scripts/analyze-storybook.js --batch-size 5 --pretty

# Analysis with existing screenshots (skip capture)
node scripts/analyze-storybook.js --skip-screenshots

# Only capture screenshots, no embeddings
node scripts/analyze-storybook.js --skip-embeddings

# Save results to file with pretty formatting
node scripts/analyze-storybook.js --output storybook-analysis.json --pretty

# Legacy: Complete analysis with all CLI arguments (still supported)
node scripts/analyze-storybook.js \
  --storybook-url https://your-storybook.vercel.app/ \
  --jina-api-key your_jina_api_key \
  --openai-api-key your_openai_api_key \
  --chromium-path /snap/chromium/current/usr/lib/chromium-browser/chrome
```

#### Complete Argument Reference

**Required Arguments:**
- `--storybook-url <url>` or `--url <url>` - URL of deployed Storybook (required unless `--skip-screenshots`)

**API Keys:**
- `--jina-api-key <key>` - Jina API key for embedding generation (required unless `--skip-embeddings`)
- `--openai-api-key <key>` - OpenAI API key for LLM component inspection (required unless `--skip-inspection`)
- `--api-key <key>` - Jina API key (backwards compatibility)

**API Keys:**
- `--jina-api-key <key>` - Jina API key for embedding generation
- `--openai-api-key <key>` - OpenAI API key for LLM component inspection
- `--api-key <key>` - Jina API key (backwards compatibility)

**General Options:**
- `--stories-dir <path>` - Directory containing story files (default: `./stories`)
- `--screenshots-dir <path>` - Directory for screenshots (default: `./__screenshots__`)
- `--batch-size <number>` - Batch size for embedding generation (default: `10`)
- `--output <file>` or `-o <file>` - Output file for results (default: stdout)
- `--pretty` - Pretty-print JSON output with indentation
- `--help` or `-h` - Show help message

**Pipeline Control:**
- `--skip-screenshots` - Skip screenshot capture step (use existing screenshots)
- `--skip-embeddings` - Skip embedding generation step
- `--skip-inspection` - Skip LLM component inspection step
- `--skip-milvus` - Skip Milvus vector database upload
- `--skip-inspection` - Skip LLM component inspection step

**LLM Inspection Options:**
- `--inspection-batch-size <number>` - Stories per inspection batch (default: `5`)
- `--inspection-model <model>` - OpenAI model (default: `gpt-5-mini`)
- `--inspection-delay-batches <ms>` - Delay between inspection batches (default: `2000`)
- `--inspection-delay-requests <ms>` - Delay between inspection requests (default: `1000`)
- `--inspection-max-tokens <number>` - Max tokens per inspection (default: `1500`)
- `--inspection-temperature <number>` - AI temperature for inspection (default: `1`)
- `--inspection-stop-on-error` - Stop on first inspection error

**Milvus Vector Database Options:**
- `--milvus-address <url>` - Milvus server address/endpoint
- `--milvus-token <token>` - Milvus authentication token
- `--milvus-collection <name>` - Collection name (default: `storybook_components`)
- `--milvus-project-id <id>` - Project ID for data organization (default: `default-project`)
- `--milvus-batch-size <number>` - Upload batch size (default: `50`)
- `--milvus-setup-collection` - Auto-create collection and indexes
- `--milvus-stop-on-error` - Stop on first upload error

**Cloudflare R2 Upload Options:**
- `--skip-r2` / `--skip-r2-upload` - Skip Cloudflare R2 screenshot upload step
- `--r2-account-id <id>` - Cloudflare Account ID (required for R2 upload)
- `--r2-access-key-id <key>` - R2 Access Key ID (required for R2 upload)
- `--r2-secret-access-key <secret>` - R2 Secret Access Key (required for R2 upload)
- `--r2-bucket-name <name>` - R2 bucket name (required for R2 upload)
- `--r2-public-domain <domain>` - Custom public domain for R2 URLs (optional)
- `--r2-base-path <path>` - Base path within R2 bucket (optional, defaults to project name)

**Storycap Options:**
- `--chromium-path <path>` - Path to Chromium executable (e.g., `/snap/chromium/current/usr/lib/chromium-browser/chrome`)
- `--out-dir <path>` - Output directory for screenshots (overrides `--screenshots-dir` for capture)
- `--parallel <number>` - Number of parallel browser instances for screenshot capture
- `--delay <ms>` - Delay between screenshots in milliseconds
- `--include <pattern>` - Include only stories matching this pattern
- `--exclude <pattern>` - Exclude stories matching this pattern
- `--no-omit-background` - Don't omit background in screenshots (default: omit background)

**LLM Inspection Options:**
- `--inspection-batch-size <number>` - Stories per inspection batch (default: `5`)
- `--inspection-model <model>` - OpenAI model (default: `gpt-5-mini`)
- `--inspection-delay-batches <ms>` - Delay between inspection batches (default: `2000`)
- `--inspection-delay-requests <ms>` - Delay between inspection requests (default: `1000`)
- `--inspection-max-tokens <number>` - Max tokens per inspection (default: `1500`)
- `--inspection-temperature <number>` - AI temperature for inspection (default: `0.1`)
- `--inspection-stop-on-error` - Stop on first inspection error

#### Pipeline Steps

The script executes the following steps in order:

1. **📸 Screenshot Capture** (if `--storybook-url` provided and not `--skip-screenshots`)
   - Runs `npx storycap` with your Storybook URL and options
   - Downloads screenshots to the specified directory

2. **📋 Story Analysis**
   - Crawls story files to extract metadata
   - Identifies component names and story exports

3. **🔗 Screenshot Mapping**
   - Maps story entries to their corresponding screenshot files
   - Handles naming conventions (camelCase to space conversion)

4. **☁️ Cloudflare R2 Upload** (if R2 credentials provided and not `--skip-r2`)
   - Uploads screenshot files to Cloudflare R2 storage
   - Generates public URLs for screenshots
   - Organizes files using configurable base path structure
   - Adds `screenshotR2Url` property to each story with successful upload

5. **🧠 Embedding Generation** (if `--jina-api-key` provided and not `--skip-embeddings`)
   - Processes screenshots in batches using Jina API
   - Generates 1024-dimensional visual embeddings

6. **🔍 LLM Component Inspection** (if `--openai-api-key` provided and not `--skip-inspection`)
   - Analyzes component screenshots using OpenAI's vision models
   - Generates detailed component documentation and analysis
   - Identifies UI patterns, accessibility features, and design tokens

#### Output Format

```json
[
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
    "embedding": [0.00765991, -0.01165771, 0.04467773, ...],
    "inspection": {
      "component_type": "Button",
      "ui_patterns": ["primary_button", "rounded_corners"],
      "visual_elements": {
        "colors": ["#007bff", "#ffffff"],
        "typography": "Medium weight sans-serif",
        "spacing": "12px horizontal, 8px vertical"
      },
      "accessibility_features": ["proper_contrast", "keyboard_focusable"],
      "design_tokens": {
        "primary_color": "#007bff",
        "border_radius": "4px"
      }
    }
  }
]
```

#### Examples

**With .env Configuration (Recommended):**

```bash
# Complete analysis with all defaults from .env
node scripts/analyze-storybook.js

# Override specific settings as needed
node scripts/analyze-storybook.js \
  --batch-size 5 \
  --inspection-batch-size 3 \
  --output analysis-results.json \
  --pretty

# Fast screenshot capture with parallel processing
node scripts/analyze-storybook.js \
  --parallel 8 \
  --delay 500 \
  --skip-embeddings

# Analysis with existing screenshots
node scripts/analyze-storybook.js \
  --skip-screenshots \
  --stories-dir ./src/stories \
  --screenshots-dir ./screenshots

# LLM inspection only (no embeddings)
node scripts/analyze-storybook.js \
  --skip-embeddings \
  --inspection-model gpt-5-mini \
  --inspection-batch-size 3

# Filtered story analysis
node scripts/analyze-storybook.js \
  --include "**/Button*" \
  --exclude "**/deprecated/*"

# Custom inspection settings
node scripts/analyze-storybook.js \
  --skip-screenshots \
  --skip-embeddings \
  --inspection-model gpt-5-mini \
  --inspection-max-tokens 2000 \
  --inspection-temperature 0.2

# Complete analysis with R2 upload (using .env credentials)
node scripts/analyze-storybook.js \
  --r2-base-path storybook-screenshots \
  --output analysis-with-r2.json \
  --pretty
```

**Legacy CLI-only Examples (Still Supported):**

```bash
# Complete analysis with all CLI arguments
node scripts/analyze-storybook.js \
  --storybook-url https://scry-nextjs-storybook.vercel.app/ \
  --chromium-path /snap/chromium/current/usr/lib/chromium-browser/chrome \
  --jina-api-key jina_your_api_key_here \
  --openai-api-key sk-your_openai_key_here \
  --batch-size 5 \
  --inspection-batch-size 3 \
  --output analysis-results.json \
  --pretty

# Complete analysis with R2 screenshot upload
node scripts/analyze-storybook.js \
  --storybook-url https://your-storybook.vercel.app/ \
  --jina-api-key your_jina_api_key \
  --openai-api-key your_openai_api_key \
  --r2-account-id your_cloudflare_account_id \
  --r2-access-key-id your_r2_access_key_id \
  --r2-secret-access-key your_r2_secret_access_key \
  --r2-bucket-name your-r2-bucket-name \
  --r2-public-domain cdn.yourdomain.com \
  --r2-base-path storybook-screenshots \
  --output analysis-with-r2.json \
  --pretty
```

#### Error Handling

- **Missing dependencies**: Warns if storycap is not available
- **Invalid URLs**: Validates Storybook URL before screenshot capture
- **API failures**: Continues processing with null embeddings/inspections for failed images
- **Missing screenshots**: Maps stories without failing when screenshots are missing
- **File permissions**: Handles read/write permission issues gracefully
- **LLM rate limits**: Built-in delays respect OpenAI API rate limits

#### Performance Tips

- **Large projects**: Use smaller `--batch-size` (3-5) for embedding generation and `--inspection-batch-size` (2-3) for LLM analysis
- **Fast capture**: Increase `--parallel` for faster screenshot capture
- **Selective analysis**: Use `--include`/`--exclude` patterns to process specific stories
- **Memory optimization**: Process screenshots in smaller batches for large datasets
- **API costs**: Monitor OpenAI usage with `--inspection-batch-size` and delay settings
- **Rate limiting**: Adjust `--inspection-delay-requests` and `--inspection-delay-batches` for your API tier

---

### `crawl-stories.js`

Recursively discovers and analyzes Storybook story files to extract metadata including component names, story names, and precise line locations.

#### Usage

```bash
# Basic usage (analyzes ./stories directory)
node scripts/crawl-stories.js

# Custom directory
node scripts/crawl-stories.js ./src/stories

# Programmatic usage
const { crawlStories } = require('./scripts/crawl-stories');
const results = crawlStories('./stories');
```

#### Output Format

```json
[
  {
    "filepath": "stories/Button.stories.ts",
    "componentName": "Button",
    "testName": "Primary",
    "location": {
      "startLine": 29,
      "endLine": 34
    }
  }
]
```

#### Features

- Recursively finds all `.stories.ts` and `.stories.tsx` files
- Extracts component names from import statements or meta objects
- Identifies exported story objects with accurate line ranges
- Handles both simple and complex story configurations

---

### `map-screenshots.js`

Maps story entries to their corresponding screenshot images, extending the story metadata with visual file paths.

#### Usage

```bash
# Basic usage
node scripts/map-screenshots.js

# Grouped by component
node scripts/map-screenshots.js --group

# Custom directories
node scripts/map-screenshots.js ./stories ./__screenshots__

# Programmatic usage
const { mapStoriesToScreenshots } = require('./scripts/map-screenshots');
const results = mapStoriesToScreenshots('./stories', './__screenshots__');
```

#### Output Format

```json
[
  {
    "filepath": "stories/Button.stories.ts",
    "componentName": "Button",
    "testName": "Primary",
    "location": {
      "startLine": 29,
      "endLine": 34
    },
    "storyTitle": "Example/Button",
    "screenshotPath": "__screenshots__/Example/Button/Primary.png"
  }
]
```

#### Features

- Integrates with `crawl-stories.js` for complete story data
- Smart screenshot matching with camelCase to space conversion
- Extracts story titles from meta objects
- Handles missing screenshots gracefully
- Optional grouped output by component

---

### `generate-embeddings.js`

Generates high-dimensional visual embeddings for screenshot images using the Jina API, enabling similarity search and ML applications.

#### Prerequisites

- Jina API key (sign up at [jina.ai](https://jina.ai))
- Screenshot images in supported formats (PNG, JPG, JPEG)

#### Usage

```bash
# Basic usage with API key
node scripts/generate-embeddings.js --api-key your_jina_api_key_here

# Custom batch size (default: 10)
node scripts/generate-embeddings.js --api-key your_key --batch-size 5

# Custom directories and batch size
node scripts/generate-embeddings.js --api-key your_key --batch-size 3 ./stories ./__screenshots__

# Help
node scripts/generate-embeddings.js --help

# Programmatic usage
const { generateEmbeddings } = require('./scripts/generate-embeddings');
const results = await generateEmbeddings('./stories', './__screenshots__', 'your_api_key');
```

#### Output Format

```json
[
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
    "embedding": [0.00765991, -0.01165771, 0.04467773, ...]
  }
]
```

#### Features

- Batch processing to respect API rate limits
- Base64 image conversion for API compatibility
- Error handling for missing images and API failures
- Progress tracking for large datasets
- 1024-dimensional embeddings using `jina-embeddings-v4` model

#### API Configuration

The script uses Jina's multimodal embedding model:
- **Model**: `jina-embeddings-v4`
- **Task**: `retrieval.query`
- **Embedding Dimensions**: 1024
- **Supported Formats**: PNG, JPG, JPEG (converted to base64)

---

### `inspect-component.js`

🧠 **AI-powered component analysis** that uses OpenAI's vision API to analyze UI component screenshots and generate standardized documentation following the component inspector prompt format.

#### Prerequisites

- OpenAI API key with vision model access (GPT-4 Vision, gpt-5-mini, etc.)
- Component screenshots in supported formats (PNG, JPG, JPEG, GIF, WebP)

#### Usage

```bash
# Basic usage
node scripts/inspect-component.js ./component.png --api-key sk-...

# With output file
node scripts/inspect-component.js \
  --image ./screenshots/button-primary.png \
  --api-key sk-... \
  --output button-analysis.json \
  --pretty

# Using environment variable for API key
OPENAI_API_KEY=sk-... node scripts/inspect-component.js ./component.png

# Custom model and parameters
node scripts/inspect-component.js \
  --image ./component.png \
  --api-key sk-... \
  --model gpt-5-mini \
  --max-tokens 2000 \
  --temperature 0.1
```

#### Arguments

**Required:**
- `--image <path>` or `-i <path>` - Path to the component image file
- `--api-key <key>` or `-k <key>` - OpenAI API key (or set `OPENAI_API_KEY` env var)

**Optional:**
- `--model <model>` or `-m <model>` - OpenAI model to use (default: `gpt-5-mini`)
- `--output <file>` or `-o <file>` - Output file for results (default: stdout)
- `--max-tokens <number>` - Maximum tokens for response (default: `1500`)
- `--temperature <number>` - Temperature for AI response (default: `0.1`)
- `--pretty` - Pretty-print JSON output
- `--help` or `-h` - Show help message

#### Output Format

```json
{
  "description": "This is a primary button component that serves as the main call-to-action element. It features a blue background with white text, rounded corners, and medium padding for optimal clickability.",
  "tags": [
    "Button",
    "React",
    "Primary",
    "Medium",
    "Blue",
    "Default",
    "Interactive",
    "Call-to-Action"
  ],
  "searchQueries": [
    "primary button component",
    "blue action button",
    "medium size button",
    "react button element",
    "call to action button"
  ],
  "metadata": {
    "imagePath": "./component.png",
    "model": "gpt-5-mini",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "rawXmlResponse": "<component-documentation>...</component-documentation>"
  }
}
```

#### Features

- Uses the standardized component inspector prompt for consistent documentation
- Automatically converts XML response from AI to structured JSON
- Supports all major image formats with automatic MIME type detection
- Comprehensive error handling for API failures and file issues
- Configurable AI model parameters for different use cases

---

### `batch-inspect-components.js`

Batch processes multiple component images for AI-powered analysis, enabling efficient documentation generation for entire component libraries.

#### Usage

```bash
# Process all images in a directory
node scripts/batch-inspect-components.js \
  --input ./__screenshots__ \
  --api-key sk-... \
  --output-file batch-results.json

# Process with individual output files
node scripts/batch-inspect-components.js \
  ./__screenshots__ \
  --api-key sk-... \
  --output-dir ./component-analyses \
  --batch-size 3

# Using environment variable for API key
OPENAI_API_KEY=sk-... node scripts/batch-inspect-components.js ./images

# Custom processing parameters
node scripts/batch-inspect-components.js \
  --input ./screenshots \
  --api-key sk-... \
  --batch-size 5 \
  --delay-batches 3000 \
  --delay-requests 1500 \
  --model gpt-5-mini
```

#### Arguments

**Required:**
- `--input <path>`, `--dir <path>`, or `-i <path>` - Directory containing component images
- `--api-key <key>` or `-k <key>` - OpenAI API key (or set `OPENAI_API_KEY` env var)

**Optional:**
- `--model <model>` or `-m <model>` - OpenAI model to use (default: `gpt-5-mini`)
- `--output-file <file>` or `-o <file>` - Output file for batch results
- `--output-dir <dir>` - Directory to save individual analysis files
- `--batch-size <number>` - Images per batch (default: `5`)
- `--delay-batches <ms>` - Delay between batches in milliseconds (default: `2000`)
- `--delay-requests <ms>` - Delay between individual requests (default: `1000`)
- `--max-tokens <number>` - Maximum tokens per response (default: `1500`)
- `--temperature <number>` - Temperature for AI responses (default: `0.1`)
- `--no-pretty` - Don't pretty-print JSON output
- `--no-metadata` - Exclude metadata from results
- `--stop-on-error` - Stop processing on first error (default: continue on error)
- `--help` or `-h` - Show help message

#### Output Format

**Batch Results File:**
```json
{
  "summary": {
    "totalImages": 25,
    "successful": 23,
    "failed": 2,
    "timestamp": "2024-01-15T10:30:00.000Z",
    "inputDirectory": "./__screenshots__"
  },
  "results": [
    {
      "success": true,
      "imagePath": "./screenshots/button-primary.png",
      "result": {
        "description": "Primary button component...",
        "tags": ["Button", "Primary", ...],
        "searchQueries": ["primary button", ...],
        "metadata": {...}
      }
    }
  ]
}
```

**Individual Analysis Files (when using `--output-dir`):**
```json
{
  "description": "Primary button component...",
  "tags": ["Button", "Primary", ...],
  "searchQueries": ["primary button", ...],
  "metadata": {...}
}
```

#### Features

- **Rate Limiting**: Built-in delays to respect OpenAI API rate limits
- **Batch Processing**: Processes images in configurable batches to manage memory and API usage
- **Error Resilience**: Continues processing when individual images fail
- **Progress Tracking**: Real-time progress reporting with detailed logging
- **Flexible Output**: Supports both consolidated batch results and individual analysis files
- **Resource Discovery**: Automatically finds all supported image formats in directories

#### Rate Limiting and Performance

The script includes intelligent rate limiting to work within OpenAI API constraints:

- **Batch Size**: Default 5 images per batch (adjustable)
- **Batch Delays**: 2-second delays between batches (adjustable)
- **Request Delays**: 1-second delays between individual requests (adjustable)
- **Error Handling**: Graceful handling of rate limit errors with exponential backoff

#### Examples

**Process Story Objects (Preferred):**
```bash
node scripts/batch-inspect-components.js \
  --stories-file stories-with-screenshots.json \
  --api-key sk-... \
  --output-file component-docs.json \
  --batch-size 3 \
  --pretty
```

**Process Screenshots Directory (Legacy):**
```bash
node scripts/batch-inspect-components.js \
  --input ./__screenshots__ \
  --api-key sk-... \
  --output-file storybook-component-docs.json \
  --batch-size 3 \
  --pretty
```

**Generate Individual Documentation Files:**
```bash
node scripts/batch-inspect-components.js \
  --stories-file ./stories.json \
  --api-key sk-... \
  --output-dir ./docs/components \
  --no-metadata
```

---

### `inspect-stories.js`

🔄 **Pipeline integration script** that seamlessly analyzes story objects from the Storybook analysis pipeline, providing an easy interface for processing structured story data with screenshot paths.

#### Usage

```bash
# From JSON file containing story objects (recommended)
node scripts/inspect-stories.js \
  --input stories-with-screenshots.json \
  --api-key sk-... \
  --output-file component-docs.json

# From stories directory (auto-maps screenshots)
node scripts/inspect-stories.js \
  --input ./stories \
  --screenshots-dir ./__screenshots__ \
  --api-key sk-... \
  --output-dir ./docs

# Pipeline integration
node scripts/map-screenshots.js > stories.json
node scripts/inspect-stories.js \
  --input stories.json \
  --api-key sk-... \
  --output-file docs.json
```

#### Arguments

**Required:**
- `--input <path>`, `--stories <path>`, or `-i <path>` - JSON file or stories directory
- `--api-key <key>` or `-k <key>` - OpenAI API key

**Optional:**
- `--screenshots-dir <path>` - Screenshots directory (default: `./__screenshots__`)
- `--model <model>` or `-m <model>` - OpenAI model (default: `gpt-5-mini`)
- `--output-file <file>` or `-o <file>` - Output file for results
- `--output-dir <dir>` - Directory for individual results
- `--batch-size <number>` - Stories per batch (default: `5`)
- All other options from `batch-inspect-components.js`

#### Expected Story Object Format

```json
{
  "filepath": "stories/Button.stories.ts",
  "componentName": "Button",
  "testName": "Primary",
  "location": {
    "startLine": 22,
    "endLine": 33
  },
  "storyTitle": "Example/Button",
  "screenshotPath": "__screenshots__/Example/Button/Primary.png"
}
```

#### Features

- **Seamless Integration**: Works directly with output from `map-screenshots.js`
- **Auto-Discovery**: Can generate story objects from directories if needed
- **Validation**: Checks for valid screenshot paths before processing
- **Flexible Input**: Supports JSON files, directories, or programmatic arrays
- **Pipeline Ready**: Designed for use in automated workflows

---

### `r2-upload.js`

📤 **Cloudflare R2 uploader utility** that provides a simple class-based interface for uploading files to Cloudflare R2 storage using the AWS SDK. Perfect for batch uploads, screenshot archiving, and asset management workflows.

#### Prerequisites

- Cloudflare R2 account with bucket configured
- R2 access credentials: Account ID, Access Key ID, and Secret Access Key
- AWS SDK v3 (`@aws-sdk/client-s3`) - automatically installed as dependency

#### Usage

**Programmatic Usage:**

```javascript
const R2Uploader = require('./scripts/r2-upload.js');

// Initialize with direct configuration
const uploader = new R2Uploader({
  accountId: 'your-cloudflare-account-id',
  accessKeyId: 'your-r2-access-key-id',
  secretAccessKey: 'your-r2-secret-access-key',
  bucketName: 'your-r2-bucket-name',
  publicDomain: 'cdn.yourdomain.com' // Optional custom domain
});

// Upload single file
const publicUrl = await uploader.uploadFile('./example.png', 'images/example.png');
console.log('Uploaded to:', publicUrl);

// Batch upload multiple files
const results = await uploader.uploadFiles([
  './file1.jpg',
  './file2.png',
  './file3.pdf'
], 'uploads/');
```

**Environment Variables Configuration:**

Set these environment variables to avoid hardcoding credentials:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
export CLOUDFLARE_ACCESS_KEY_ID=your-access-key
export CLOUDFLARE_SECRET_ACCESS_KEY=your-secret-key
export R2_BUCKET_NAME=your-bucket-name
export R2_PUBLIC_DOMAIN=cdn.yourdomain.com  # Optional
```

Then initialize without parameters:
```javascript
const uploader = new R2Uploader(); // Uses environment variables
```

#### Configuration Options

**Constructor Parameters:**
- `accountId` - Cloudflare account ID (required)
- `accessKeyId` - R2 access key ID (required)
- `secretAccessKey` - R2 secret access key (required)
- `bucketName` - R2 bucket name (required)
- `publicDomain` - Custom domain for public URLs (optional)

**Environment Variables:**
- `CLOUDFLARE_ACCOUNT_ID` - Account ID fallback
- `CLOUDFLARE_ACCESS_KEY_ID` - Access key fallback
- `CLOUDFLARE_SECRET_ACCESS_KEY` - Secret key fallback
- `R2_BUCKET_NAME` - Bucket name fallback
- `R2_PUBLIC_DOMAIN` - Public domain fallback

#### Methods

**`uploadFile(filePath, destinationPath)`**
- **filePath** (string): Local file path to upload
- **destinationPath** (string, optional): Destination path in R2 bucket. If not provided, uses relative path from project root
- **Returns**: Promise\<string> - Public URL of uploaded file

**`uploadFiles(filePaths, baseR2Path)`**
- **filePaths** (string[]): Array of local file paths to upload
- **baseR2Path** (string, optional): Base path in R2 bucket for all uploads (default: '')
- **Returns**: Promise\<Array\<{originalPath: string, r2Url: string}>> - Array of upload results

#### Supported File Types

The uploader automatically detects MIME types for common formats:
- **Images**: JPG, JPEG, PNG, GIF, WebP, SVG
- **Documents**: PDF, TXT, HTML, CSS, JS, JSON, XML
- **Archives**: ZIP
- **Media**: MP4, MP3, WAV
- **Fallback**: `application/octet-stream` for unknown types

#### Error Handling

- **Missing credentials**: Constructor throws error if required configuration is missing
- **File not found**: `uploadFile` throws error if local file doesn't exist
- **Upload failures**: Individual file failures in batch uploads are logged as warnings but don't stop the batch
- **API errors**: Network and R2 API errors are caught and re-thrown with descriptive messages

#### Examples

**Upload Screenshots from Storybook Analysis:**
```javascript
const R2Uploader = require('./scripts/r2-upload.js');
const { mapStoriesToScreenshots } = require('./scripts/map-screenshots');

async function archiveScreenshots() {
  const uploader = new R2Uploader(); // Uses env vars
  const stories = mapStoriesToScreenshots('./stories', './__screenshots__');
  
  // Extract screenshot paths
  const screenshotPaths = stories
    .filter(story => story.screenshotPath)
    .map(story => story.screenshotPath);
  
  // Upload to R2 with organized structure
  const results = await uploader.uploadFiles(screenshotPaths, 'storybook-screenshots/');
  
  console.log(`Uploaded ${results.length} screenshots`);
  return results;
}
```

**Upload Analysis Results:**
```javascript
const R2Uploader = require('./scripts/r2-upload.js');

async function uploadAnalysisResults() {
  const uploader = new R2Uploader({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME
  });
  
  // Upload analysis file
  const resultUrl = await uploader.uploadFile(
    './analysis-results.json',
    'data/storybook-analysis.json'
  );
  
  console.log('Analysis results available at:', resultUrl);
  return resultUrl;
}
```

**Integration with Analysis Pipeline:**
```javascript
const R2Uploader = require('./scripts/r2-upload.js');
const { generateEmbeddings } = require('./scripts/generate-embeddings');

async function analyzeAndUpload() {
  // Generate analysis results
  const results = await generateEmbeddings('./stories', './__screenshots__', process.env.JINA_API_KEY);
  
  // Save results locally
  const resultsFile = './analysis-results.json';
  require('fs').writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  
  // Upload to R2 for sharing/backup
  const uploader = new R2Uploader();
  const publicUrl = await uploader.uploadFile(resultsFile, 'analyses/latest.json');
  
  console.log('Analysis results uploaded to:', publicUrl);
  return { results, publicUrl };
}
```

#### Features

- **AWS SDK Integration**: Uses the official AWS SDK v3 for reliable R2 compatibility
- **Environment Variable Support**: Flexible configuration via environment variables
- **Automatic Path Resolution**: Derives R2 paths from local file paths when not specified
- **MIME Type Detection**: Automatically sets appropriate content types for uploads
- **Batch Processing**: Efficient batch uploads with individual error handling
- **Progress Logging**: Detailed console output for upload tracking
- **Error Resilience**: Continues batch uploads even when individual files fail
- **Public URL Generation**: Constructs accessible URLs for uploaded files
- **CommonJS Compatible**: Ready for use with `require()` syntax

#### Rate Limiting and Performance

- **Concurrent Uploads**: Processes batch uploads sequentially to avoid overwhelming the API
- **Error Recovery**: Individual file failures don't stop batch processing
- **Memory Efficient**: Reads files on-demand rather than loading entire batches into memory
- **Network Resilient**: AWS SDK provides built-in retry logic for network issues

#### Integration with Other Scripts

The R2 uploader works seamlessly with other scripts in this toolkit:

```bash
# Generate analysis and upload results
node scripts/analyze-storybook.js --output analysis.json && \
node -e "
  const R2Uploader = require('./scripts/r2-upload.js');
  const uploader = new R2Uploader();
  uploader.uploadFile('./analysis.json', 'data/storybook-analysis.json')
    .then(url => console.log('Uploaded to:', url));
"

# Upload all screenshots after analysis
node -e "
  const R2Uploader = require('./scripts/r2-upload.js');
  const glob = require('glob');
  const uploader = new R2Uploader();
  
  glob('./__screenshots__/**/*.png', (err, files) => {
    if (err) throw err;
    uploader.uploadFiles(files, 'screenshots/')
      .then(results => console.log(\`Uploaded \${results.length} files\`));
  });
"
```

### `push-env-to-vercel.js`

📤 **Environment Variable Pusher** that reads environment variables from a file and pushes them to Vercel using the Vercel CLI. Perfect for synchronizing local environment configuration with Vercel projects.

#### Prerequisites

- Vercel CLI installed and configured with a project
- Environment file with variables in KEY=VALUE format

#### Usage

```bash
# Display help
node scripts/push-env-to-vercel.js --help

# Push variables from .env.local to production environment (default)
node scripts/push-env-to-vercel.js

# Push variables from a specific file to production environment
node scripts/push-env-to-vercel.js .env.production

# Push variables from .env.local to preview environment
node scripts/push-env-to-vercel.js .env.local preview

# Push variables from .env.development to development environment
node scripts/push-env-to-vercel.js .env.development development

# Using flags
node scripts/push-env-to-vercel.js --file .env.staging --environment preview
node scripts/push-env-to-vercel.js -f .env.dev -e development
```

#### Options

```
-f, --file <path>          Specify environment file path
-e, --environment <env>    Specify Vercel environment (production, preview, development)
-h, --help                 Display help message
```

#### Features

- **Sequential Processing**: Processes environment variables one at a time to avoid overwhelming the Vercel API
- **Comment Support**: Automatically skips lines starting with # and empty lines
- **Quote Handling**: Automatically removes surrounding quotes from values
- **Flexible Input**: Works with any file that follows the KEY=VALUE format
- **Environment Targeting**: Supports production, preview, and development environments
- **Error Resilience**: Continues processing even if individual variables fail to set
- **Proper CLI Interface**: Full command-line interface with help and options
- **Argument Validation**: Validates environment targets and file existence

#### Example Environment File Format

```bash
# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
DATABASE_POOL_SIZE=10

# API Keys
STRIPE_SECRET_KEY=sk_test_1234567890abcdef
SENDGRID_API_KEY=SG.xxxxxx

# Feature Flags
FEATURE_NEW_DASHBOARD=true
FEATURE_MULTI_TENANCY=false
```

#### Integration with Existing Scripts

The environment variable pusher works well with the existing configuration system:

```bash
# Copy example configuration
cp .env.example .env.local

# Edit with your values
nano .env.local

# Push to Vercel
node scripts/push-env-to-vercel.js
```

## Workflow Examples

### Complete Analysis Pipeline

```bash
# 1. Extract story metadata
node scripts/crawl-stories.js > stories-metadata.json

# 2. Map screenshots to stories
node scripts/map-screenshots.js > stories-with-screenshots.json

# 3. Generate embeddings for visual analysis
node scripts/generate-embeddings.js --api-key your_key > stories-with-embeddings.json
```

### Programmatic Integration

```javascript
const { crawlStories } = require('./scripts/crawl-stories');
const { mapStoriesToScreenshots } = require('./scripts/map-screenshots');
const { generateEmbeddings } = require('./scripts/generate-embeddings');

async function analyzeStorybook() {
  // Get basic story data
  const stories = crawlStories('./stories');
  
  // Add screenshot paths
  const storiesWithScreenshots = mapStoriesToScreenshots('./stories', './__screenshots__');
  
  // Add visual embeddings
  const storiesWithEmbeddings = await generateEmbeddings(
    './stories', 
    './__screenshots__', 
    process.env.JINA_API_KEY
  );
  
  return storiesWithEmbeddings;
}
```

## File Structure

```
scripts/
├── README.md                 # This documentation
├── crawl-stories.js         # Story metadata extraction
├── map-screenshots.js       # Screenshot mapping
└── generate-embeddings.js   # AI embedding generation

stories/                     # Storybook stories
├── Button.stories.ts
├── Header.stories.ts
└── Page.stories.ts

__screenshots__/             # Screenshot images
└── Example/
    ├── Button/
    │   ├── Primary.png
    │   ├── Secondary.png
    │   ├── Large.png
    │   └── Small.png
    ├── Header/
    │   ├── Logged In.png
    │   └── Logged Out.png
    └── Page/
        ├── Logged In.png
        └── Logged Out.png
```

## Error Handling

All scripts include comprehensive error handling:

- **Missing files**: Scripts continue processing and report which files couldn't be found
- **API errors**: Embedding generation continues with null values for failed images
- **Invalid syntax**: Story parsing skips malformed files and reports errors
- **Rate limiting**: Batch processing with delays between API calls

## Performance Considerations

- **Large datasets**: Use smaller batch sizes for embedding generation (e.g., `--batch-size 3`)
- **API costs**: Jina API charges per embedding; monitor usage for large screenshot collections
- **Memory usage**: Scripts process files incrementally to handle large codebases
- **Network timeouts**: Built-in retry logic for API requests

## Use Cases

- **Component Documentation**: Generate comprehensive component catalogs with visual examples
- **Visual Testing**: Compare component screenshots across versions using embeddings
- **Design System Analysis**: Identify similar UI components using visual similarity
- **Automated QA**: Detect visual regressions by comparing embedding distances
- **Search and Discovery**: Build visual search for component libraries

## Contributing

When adding new features:

1. Follow existing error handling patterns
2. Include comprehensive JSDoc comments
3. Add command-line help text for new options
4. Test with both small and large datasets
5. Update this README with new functionality

## License

These scripts are part of the Storybook analysis toolkit and follow the project's license terms.

---

## TL;DR

**🚀 All-in-One Quick Start:**

```bash
# Complete analysis pipeline with .env configuration (recommended)
# 1. Copy .env.example to .env and fill in your values
# 2. Run the complete pipeline
node scripts/analyze-storybook.js

# Complete analysis pipeline with CLI arguments (legacy)
node scripts/analyze-storybook.js \
  --storybook-url https://your-storybook.vercel.app/ \
  --jina-api-key your_jina_api_key \
  --openai-api-key your_openai_api_key \
  --r2-account-id your_cloudflare_account_id \
  --r2-access-key-id your_r2_access_key_id \
  --r2-secret-access-key your_r2_secret_access_key \
  --r2-bucket-name your-r2-bucket-name \
  --milvus-address your_milvus_endpoint \
  --milvus-token your_milvus_token \
  --milvus-setup-collection \
  --chromium-path /snap/chromium/current/usr/lib/chromium-browser/chrome
```

**Individual Scripts:**

```bash
# 1. Extract all story metadata
node scripts/crawl-stories.js

# 2. Map stories to screenshots
node scripts/map-screenshots.js

# 3. Generate AI embeddings (requires Jina API key)
node scripts/generate-embeddings.js --api-key your_jina_api_key_here

# 4. Generate LLM component analysis (requires OpenAI API key)
node scripts/batch-inspect-components.js \
  --stories-file stories-with-screenshots.json \
  --api-key your_openai_api_key
```

**What it does:** Analyzes your Storybook project to extract component metadata, capture/map visual screenshots, upload screenshots to Cloudflare R2 storage, generate AI embeddings, create detailed LLM-powered component documentation, and upload everything to a vector database for semantic search. Perfect for component documentation, visual testing, design system analysis, and building intelligent, searchable component libraries with cloud-hosted assets.

**Output:** JSON with story locations, component names, screenshot paths, R2 public URLs, 1024-dimensional visual embeddings, comprehensive LLM-generated component analysis including UI patterns, accessibility features, and design tokens, plus optional vector database upload results for semantic search capabilities.