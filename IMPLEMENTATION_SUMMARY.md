# Storybook Analysis Integration - Implementation Summary

## Overview
Successfully integrated Storybook analysis functionality into the storybook-deployer CLI, enabling screenshot capture, story metadata extraction, and organized ZIP packaging.

## What Was Implemented

### 1. New Modules Created

#### [`lib/screencap.js`](lib/screencap.js)
- Wraps `storycap` functionality for screenshot capture
- Configurable options: chromiumPath, outDir, parallel, delay, include/exclude patterns

#### [`lib/analysis.js`](lib/analysis.js)
- **Core analysis functions** (extracted from newscripts):
  - `crawlStories()` - Finds and parses all .stories.ts/.tsx files
  - `mapStoriesToScreenshots()` - Maps stories to their screenshot files
  - `analyzeStorybook()` - Main analysis function with metadata generation
- **NO API dependencies** - Pure file analysis and mapping

#### [`lib/archiveUtils.js`](lib/archiveUtils.js)
- `createMasterZip()` - Creates master ZIP with:
  - `staticsite/` folder (optional)
  - `images/` folder (screenshots)
  - `metadata.json` file

### 2. Updated Modules

#### [`lib/archive.js`](lib/archive.js:11)
- Enhanced `zipDirectory()` to support custom internal paths
- Maintains backward compatibility with existing code

#### [`lib/config.js`](lib/config.js)
- Added analysis configuration options:
  - `withAnalysis`, `storiesDir`, `screenshotsDir`, `storybookUrl`
  - `storycapOptions` object for screenshot capture settings
- Environment variable support for all new options

#### [`lib/apiClient.js`](lib/apiClient.js:54)
- Updated file naming to use `{project}-{version}.zip` pattern
- Maintains presigned URL workflow

#### [`bin/cli.js`](bin/cli.js)
- **Restructured with yargs commands**:
  - Default command: `storybook-deploy` (existing deployment)
  - New command: `storybook-deploy analyze`
- Added `--with-analysis` flag for integrated workflow
- Comprehensive logging throughout both workflows

### 3. Package Dependencies

#### [`package.json`](package.json:31)
- Added `storycap: ^4.2.0` for screenshot capture

## File Structure

### Master ZIP Structure
```
project-version.zip
├── staticsite/          # Full storybook-static contents (deploy with --with-analysis)
│   ├── index.html
│   └── ...
├── images/              # All screenshots
│   └── Components/
│       └── Button/
│           ├── Primary.png
│           └── Secondary.png
└── metadata.json       # Analysis metadata
```

### Metadata JSON Structure
```json
{
  "project": "myproject",
  "version": "0.0.1",
  "timestamp": "2025-09-30T12:48:00Z",
  "summary": {
    "totalStories": 10,
    "withScreenshots": 8
  },
  "stories": [
    {
      "filepath": "stories/Button.stories.tsx",
      "componentName": "Button",
      "testName": "Primary",
      "storyTitle": "Components/Button",
      "location": {
        "startLine": 15,
        "endLine": 20
      },
      "screenshotPath": "images/Components/Button/Primary.png"
    }
  ]
}
```

## Usage Examples

### 1. Standalone Analysis Command
```bash
storybook-deploy analyze \
  --project myproject \
  --version 0.0.1 \
  --storybook-url http://localhost:6006 \
  --stories-dir ./stories \
  --screenshots-dir ./__screenshots__
```

**Workflow:**
1. Capture screenshots using storycap
2. Crawl story files and extract metadata
3. Map screenshots to stories
4. Create master ZIP (images/ + metadata.json)
5. Upload as `myproject-0.0.1.zip`

### 2. Deploy with Analysis (Integrated)
```bash
storybook-deploy \
  --dir ./storybook-static \
  --project myproject \
  --version 0.0.1 \
  --with-analysis \
  --storybook-url http://localhost:6006 \
  --stories-dir ./stories \
  --screenshots-dir ./__screenshots__
```

**Workflow:**
1. Capture screenshots using storycap
2. Crawl story files and extract metadata
3. Map screenshots to stories
4. Create master ZIP (staticsite/ + images/ + metadata.json)
5. Upload as `myproject-0.0.1.zip`

### 3. Simple Deploy (No Analysis)
```bash
storybook-deploy \
  --dir ./storybook-static \
  --project myproject \
  --version 0.0.1
```

**Workflow:**
1. Zip storybook-static directory
2. Upload as `myproject-0.0.1.zip`

## Configuration Options

### CLI Flags
- `--with-analysis` - Enable analysis in deploy command
- `--storybook-url` - URL for screenshot capture
- `--stories-dir` - Story files directory (default: ./stories)
- `--screenshots-dir` - Screenshots directory (default: ./__screenshots__)

### Environment Variables
- `STORYBOOK_DEPLOYER_WITH_ANALYSIS=true`
- `STORYBOOK_DEPLOYER_STORYBOOK_URL=http://localhost:6006`
- `STORYBOOK_DEPLOYER_STORIES_DIR=./stories`
- `STORYBOOK_DEPLOYER_SCREENSHOTS_DIR=./__screenshots__`

### Config File (.storybook-deployer.json)
```json
{
  "apiUrl": "https://api.example.com",
  "apiKey": "your-api-key",
  "project": "myproject",
  "version": "1.0.0",
  "withAnalysis": true,
  "storybookUrl": "http://localhost:6006",
  "storiesDir": "./stories",
  "screenshotsDir": "./__screenshots__"
}
```

## What Was Excluded (By Design)

The following features from `newscripts/` were intentionally excluded:
- ❌ Jina API embeddings generation
- ❌ OpenAI LLM component inspection
- ❌ Milvus vector database uploads
- ❌ R2 cloud storage uploads
- ❌ Text embeddings generation

These were excluded to keep the core CLI focused on deployment and basic analysis without external API dependencies.

## Next Steps

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Test Standalone Analysis:**
   ```bash
   storybook-deploy analyze \
     --project test \
     --version 1.0.0 \
     --stories-dir ./path/to/stories
   ```

3. **Test Integrated Deployment:**
   ```bash
   storybook-deploy \
     --dir ./storybook-static \
     --project test \
     --version 1.0.0 \
     --with-analysis
   ```

## Implementation Status

✅ All core functionality implemented
✅ Master ZIP structure with proper organization
✅ Metadata JSON with project/version fields
✅ Screenshot capture integration
✅ Story crawling and mapping
✅ Dual command structure (deploy + analyze)
✅ Comprehensive logging
✅ Configuration management

Ready for testing and deployment!