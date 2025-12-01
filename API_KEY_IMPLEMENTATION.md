# API Key Authentication - CLI Implementation Plan

**Project**: Scry CLI (scry-node)
**Goal**: Update CLI to support API key authentication for uploads
**Estimated Effort**: 1 hour

---

## 1. Configuration

### 1.1 Environment Variables
- Support `SCRY_API_KEY` environment variable

### 1.2 Config File
- Support `apiKey` in `.scryrc` or `scry.config.json`

### 1.3 Command Flags
- Support `--api-key` flag in `deploy` command

---

## 2. Code Implementation

### 2.1 Update Upload Logic
Update `src/commands/deploy.ts` (or relevant upload script):
- Resolve API key from (in order):
  1. Flag (`--api-key`)
  2. Environment variable (`SCRY_API_KEY`)
  3. Config file
- Validate API key is present (throw error if missing)
- Add `x-api-key` header to the upload request

### 2.2 Error Handling
- Handle 401/403 errors from upload service
- Display helpful error message: "Invalid API Key. Please check your key or generate a new one in the dashboard."

---

## 3. Testing

- Test with valid key (env var)
- Test with valid key (flag)
- Test with missing key
- Test with invalid key (mocked response)

---

## 4. Release

- Bump version
- Publish to npm (if applicable) or update internal distribution