# CLI Implementation Spec — Shared JWT (Private Projects)

## Overview

The CLI requires **minimal changes** for private projects. The Shared JWT approach handles authentication at the browser level, so CLI-generated links work seamlessly.

**Estimated Effort**: 0.5 days (mostly documentation)

---

## Why Minimal Changes?

1. **Upload flow unchanged**: CLI uploads to R2 using API keys (not affected by visibility)
2. **Links work via browser**: When users click Storybook/coverage links, the browser sends the session cookie automatically
3. **No CLI-side auth needed**: The CDN validates the cookie, not the CLI

---

## Changes Required

### 1. Update Link Output Messages

When the CLI outputs links after upload, add a note about private projects:

**File**: `scry-node/lib/upload.js` (or equivalent)

```javascript
function printUploadSuccess(result) {
  console.log('\n✅ Upload successful!\n');
  console.log(`📖 Storybook: ${result.storybookUrl}`);
  console.log(`📊 Coverage:  ${result.coverageUrl}`);
  
  // Add note about private projects
  if (result.visibility === 'private') {
    console.log('\n🔒 This project is private. Viewers must be logged in to access.');
  }
}
```

### 2. Add Visibility to Upload Response

The upload API should return the project's visibility so the CLI can display appropriate messaging:

**API Response Update** (CDN service):

```json
{
  "success": true,
  "projectId": "my-project",
  "versionId": "v1.2.3",
  "storybookUrl": "https://view.scrymore.com/my-project/v1.2.3/",
  "coverageUrl": "https://view.scrymore.com/my-project/v1.2.3/coverage/",
  "visibility": "private"
}
```

### 3. Documentation Update

Update CLI README to explain private project behavior:

**File**: `scry-node/README.md` (add section)

```markdown
## Private Projects

If your project is set to **private** in the Scry dashboard, uploaded Storybook 
and coverage reports will only be accessible to logged-in project members.

### How it works

1. Upload works the same way (using your API key)
2. The generated links work for anyone who is:
   - Logged into the Scry dashboard
   - A member of your project

### Sharing with team members

To give someone access to a private project:

1. Go to your project in the [Scry Dashboard](https://dashboard.scrymore.com)
2. Navigate to **Settings** → **Members**
3. Add their email address

They'll need to log in once, then all project links will work automatically.
```

---

## No Changes Required

The following CLI functionality remains unchanged:

| Feature | Reason |
|---------|--------|
| `scry upload` | Uses API key auth, not affected by visibility |
| `scry login` | Already works, creates session cookie in browser |
| `scry init` | Project creation unchanged |
| `scry config` | No visibility config needed in CLI |

---

## Testing

### Test Files (Optional)

Since CLI changes are minimal (output formatting only), unit tests are optional but recommended:

**File**: `scry-node/test/upload.test.js`

```javascript
import { describe, it, expect, vi } from 'vitest';
import { formatUploadSuccess } from '../lib/upload.js';

describe('formatUploadSuccess', () => {
  it('shows visibility message for private projects', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    
    formatUploadSuccess({
      storybookUrl: 'https://view.scrymore.com/project/v1/',
      coverageUrl: 'https://view.scrymore.com/project/v1/coverage/',
      visibility: 'private',
    });
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('private')
    );
  });

  it('does not show visibility message for public projects', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    
    formatUploadSuccess({
      storybookUrl: 'https://view.scrymore.com/project/v1/',
      coverageUrl: 'https://view.scrymore.com/project/v1/coverage/',
      visibility: 'public',
    });
    
    // Should not mention private/login
    const allCalls = consoleSpy.mock.calls.flat().join(' ');
    expect(allCalls).not.toContain('logged in');
  });

  it('handles missing visibility field (defaults to public behavior)', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    
    formatUploadSuccess({
      storybookUrl: 'https://view.scrymore.com/project/v1/',
      coverageUrl: 'https://view.scrymore.com/project/v1/coverage/',
      // No visibility field
    });
    
    // Should not show private message
    const allCalls = consoleSpy.mock.calls.flat().join(' ');
    expect(allCalls).not.toContain('private');
  });
});
```

---

### Manual Testing Checklist

#### Public Project Upload

- [ ] Run `scry upload` on public project
- [ ] Verify success message shows URLs
- [ ] Verify no "private" message shown
- [ ] Click Storybook link → loads without login
- [ ] Click coverage link → loads without login

#### Private Project Upload

- [ ] Run `scry upload` on private project
- [ ] Verify success message shows URLs
- [ ] Verify "🔒 This project is private" message shown
- [ ] Click Storybook link in incognito → 401 Unauthorized
- [ ] Login to dashboard
- [ ] Click Storybook link → loads successfully

#### Edge Cases

- [ ] Upload when API doesn't return visibility field → no crash
- [ ] Upload with network error → existing error handling works

---

### Running Tests

```bash
# Run CLI tests (if implemented)
cd scry-node
npm test

# Run specific test file
npm test test/upload.test.js
```

---

### Test Coverage Goals

| Component | Target |
|-----------|--------|
| Upload output formatting | 80%+ (if tests added) |
| Manual E2E testing | All checklist items |

---

## Rollout Checklist

- [ ] Update upload success message to show visibility
- [ ] Update CLI README with private projects section
- [ ] Test with public project
- [ ] Test with private project
- [ ] Release new CLI version (patch bump)

---

## Files Changed

| File | Change |
|------|--------|
| `scry-node/lib/upload.js` | Add visibility to output |
| `scry-node/README.md` | Add private projects docs |

---

## Dependencies

None. The CLI doesn't need any new packages.
