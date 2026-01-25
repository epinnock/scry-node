# PR: CLI Shared JWT Support for Private Projects

## Summary

This PR implements the CLI changes specified in `03-cli-shared-jwt-spec.md` to support private project visibility messaging. When a project is set to private in the Scry dashboard, the CLI now displays an appropriate message after upload indicating that viewers must be logged in to access the deployed Storybook.

## What Changed

### 1. API Client (`lib/apiClient.js`)

- **`requestPresignedUrl()`** now returns `{ url, visibility }` instead of just the URL string
- Extracts `visibility` field from the presigned URL API response
- **`uploadFileDirectly()`** passes through the visibility in its return value

### 2. CLI (`bin/cli.js`)

- **`buildDeployResult()`** accepts a third parameter `uploadResult` and includes `visibility` in the returned object
- **New `logUploadLinks()`** function prints:
  - Storybook URL
  - Coverage URL (if available)
  - Private project notice when `visibility === 'private'`
- Both deployment paths (with/without analysis) now call `logUploadLinks()` after successful upload

### 3. Documentation (`README.md`)

Added a new "Private Projects" section explaining:
- How private project access works
- That upload uses API key auth (unchanged)
- How to share access with team members via the dashboard

## Files Changed

| File | Change |
|------|--------|
| `lib/apiClient.js` | Return visibility from presigned URL response |
| `bin/cli.js` | Add visibility to deploy result, new `logUploadLinks()` function |
| `test/apiClient.test.js` | Updated tests for visibility handling |
| `test/cli.test.js` | Added tests for `logUploadLinks()` and visibility in `buildDeployResult()` |
| `README.md` | Added Private Projects documentation section |

## How to Test

### Automated Tests
```bash
pnpm test
```

All 30 tests pass.

### Manual Testing Checklist

#### Public Project Upload
- [ ] Run `scry upload` on a public project
- [ ] Verify success message shows URLs
- [ ] Verify no "private" message shown

#### Private Project Upload
- [ ] Run `scry upload` on a private project
- [ ] Verify success message shows URLs
- [ ] Verify "🔒 This project is private. Viewers must be logged in to access." message shown

#### Edge Cases
- [ ] Upload when API doesn't return visibility field → no crash, no private message
- [ ] Upload with network error → existing error handling works

## API Contract

The presigned URL endpoint should now return:

```json
{
  "url": "https://...",
  "visibility": "private" | "public"
}
```

If `visibility` is not present, the CLI treats it as public (no private message shown).

## Output Example

### Public Project
```
✅ Upload successful!

📖 Storybook: https://view.scrymore.com/my-project/v1.2.3/
📊 Coverage:  https://view.scrymore.com/my-project/v1.2.3/coverage-report.json
```

### Private Project
```
✅ Upload successful!

📖 Storybook: https://view.scrymore.com/my-project/v1.2.3/
📊 Coverage:  https://view.scrymore.com/my-project/v1.2.3/coverage-report.json

🔒 This project is private. Viewers must be logged in to access.
```

## Backward Compatibility

- No breaking changes
- If the backend doesn't return `visibility`, the CLI behaves as before (no private message)
- All existing functionality preserved

## Related

- Spec: `03-cli-shared-jwt-spec.md`
- Backend PR: (link to CDN service PR that adds visibility to response)
