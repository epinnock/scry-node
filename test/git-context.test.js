const fs = require('fs');
const path = require('path');

describe('lib/git-context', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to clear any cached env values
    jest.resetModules();
    // Create a clean environment for each test
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('getGitContext()', () => {
    test('returns empty context when no CI and no git', () => {
      // Mock execSync to fail (no git available)
      jest.doMock('child_process', () => ({
        execSync: jest.fn(() => {
          throw new Error('git not found');
        }),
      }));

      const { getGitContext } = require('../lib/git-context.js');
      const context = getGitContext();

      expect(context).toEqual({
        commitSha: null,
        branch: null,
        buildUrl: null,
        buildId: null,
        prNumber: null,
        commitUrl: null,
      });
    });

    test('prioritizes GitHub Actions over local git', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_SHA = 'abc123def456';
      process.env.GITHUB_REF_NAME = 'main';

      const { getGitContext } = require('../lib/git-context.js');
      const context = getGitContext();

      expect(context.commitSha).toBe('abc123def456');
      expect(context.branch).toBe('main');
    });

    test('prioritizes GitLab CI when GitHub not present', () => {
      process.env.GITLAB_CI = 'true';
      process.env.CI_COMMIT_SHA = 'gitlab123';
      process.env.CI_COMMIT_REF_NAME = 'develop';

      const { getGitContext } = require('../lib/git-context.js');
      const context = getGitContext();

      expect(context.commitSha).toBe('gitlab123');
      expect(context.branch).toBe('develop');
    });

    test('prioritizes Bitbucket when GitHub and GitLab not present', () => {
      process.env.BITBUCKET_BUILD_NUMBER = '42';
      process.env.BITBUCKET_COMMIT = 'bitbucket123';
      process.env.BITBUCKET_BRANCH = 'feature/test';

      const { getGitContext } = require('../lib/git-context.js');
      const context = getGitContext();

      expect(context.commitSha).toBe('bitbucket123');
      expect(context.branch).toBe('feature/test');
      expect(context.buildId).toBe('42');
    });

    test('prioritizes CircleCI when other CIs not present', () => {
      process.env.CIRCLECI = 'true';
      process.env.CIRCLE_SHA1 = 'circle123';
      process.env.CIRCLE_BRANCH = 'circle-branch';

      const { getGitContext } = require('../lib/git-context.js');
      const context = getGitContext();

      expect(context.commitSha).toBe('circle123');
      expect(context.branch).toBe('circle-branch');
    });
  });

  describe('extractGitHubContext()', () => {
    test('returns empty object when not in GitHub Actions', () => {
      const { extractGitHubContext } = require('../lib/git-context.js');
      expect(extractGitHubContext()).toEqual({});
    });

    test('extracts commitSha from GITHUB_SHA', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_SHA = 'abc123def456789';

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.commitSha).toBe('abc123def456789');
    });

    test('extracts branch from GITHUB_REF_NAME', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_REF_NAME = 'feature/my-branch';

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.branch).toBe('feature/my-branch');
    });

    test('parses branch from GITHUB_REF when GITHUB_REF_NAME not available', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_REF = 'refs/heads/main';

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.branch).toBe('main');
    });

    test('parses tag from GITHUB_REF', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_REF = 'refs/tags/v1.0.0';

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.branch).toBe('v1.0.0');
    });

    test('parses PR number from GITHUB_REF', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_REF = 'refs/pull/123/merge';

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.prNumber).toBe(123);
    });

    test('reads PR number from event payload when not in ref', () => {
      const eventPath = path.join(__dirname, 'fixtures', 'github-event-with-pr-number.json');
      fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 456 } }));

      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_EVENT_PATH = eventPath;

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.prNumber).toBe(456);

      // Cleanup
      fs.unlinkSync(eventPath);
    });

    test('does not read PR from event when already found in ref', () => {
      const eventPath = path.join(__dirname, 'fixtures', 'github-event-pr-override.json');
      fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 999 } }));

      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_REF = 'refs/pull/123/merge';
      process.env.GITHUB_EVENT_PATH = eventPath;

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      // Should use the PR number from ref, not from event
      expect(context.prNumber).toBe(123);

      // Cleanup
      fs.unlinkSync(eventPath);
    });

    test('extracts buildId from GITHUB_RUN_ID', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_RUN_ID = '12345';

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.buildId).toBe('12345');
    });

    test('constructs buildUrl from GitHub env vars', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_REPOSITORY = 'owner/repo';
      process.env.GITHUB_RUN_ID = '12345';

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.buildUrl).toBe('https://github.com/owner/repo/actions/runs/12345');
    });

    test('constructs commitUrl from GitHub env vars', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_REPOSITORY = 'owner/repo';
      process.env.GITHUB_SHA = 'abc123';

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.commitUrl).toBe('https://github.com/owner/repo/commit/abc123');
    });

    test('handles missing optional fields gracefully', () => {
      process.env.GITHUB_ACTIONS = 'true';
      // Only set GITHUB_ACTIONS, nothing else

      const { extractGitHubContext } = require('../lib/git-context.js');
      const context = extractGitHubContext();

      expect(context.commitSha).toBeUndefined();
      expect(context.branch).toBeUndefined();
      expect(context.buildUrl).toBeUndefined();
    });
  });

  describe('extractGitLabContext()', () => {
    test('returns empty object when not in GitLab CI', () => {
      const { extractGitLabContext } = require('../lib/git-context.js');
      expect(extractGitLabContext()).toEqual({});
    });

    test('extracts all GitLab CI fields', () => {
      process.env.GITLAB_CI = 'true';
      process.env.CI_COMMIT_SHA = 'gitlab-sha-123';
      process.env.CI_COMMIT_REF_NAME = 'feature/gitlab-branch';
      process.env.CI_PIPELINE_ID = '9876';
      process.env.CI_PIPELINE_URL = 'https://gitlab.com/project/-/pipelines/9876';
      process.env.CI_MERGE_REQUEST_IID = '42';
      process.env.CI_PROJECT_URL = 'https://gitlab.com/project';

      const { extractGitLabContext } = require('../lib/git-context.js');
      const context = extractGitLabContext();

      expect(context.commitSha).toBe('gitlab-sha-123');
      expect(context.branch).toBe('feature/gitlab-branch');
      expect(context.buildId).toBe('9876');
      expect(context.buildUrl).toBe('https://gitlab.com/project/-/pipelines/9876');
      expect(context.prNumber).toBe(42);
      expect(context.commitUrl).toBe('https://gitlab.com/project/-/commit/gitlab-sha-123');
    });

    test('handles GitLab CI without MR IID or project URL', () => {
      process.env.GITLAB_CI = 'true';
      process.env.CI_COMMIT_SHA = 'gitlab-sha-456';
      process.env.CI_COMMIT_REF_NAME = 'main';
      // No CI_MERGE_REQUEST_IID, no CI_PROJECT_URL

      const { extractGitLabContext } = require('../lib/git-context.js');
      const context = extractGitLabContext();

      expect(context.commitSha).toBe('gitlab-sha-456');
      expect(context.branch).toBe('main');
      expect(context.prNumber).toBeUndefined();
      expect(context.commitUrl).toBeUndefined();
    });
  });

  describe('extractBitbucketContext()', () => {
    test('returns empty object when not in Bitbucket Pipelines', () => {
      const { extractBitbucketContext } = require('../lib/git-context.js');
      expect(extractBitbucketContext()).toEqual({});
    });

    test('extracts all Bitbucket fields', () => {
      process.env.BITBUCKET_BUILD_NUMBER = '100';
      process.env.BITBUCKET_COMMIT = 'bb-commit-sha';
      process.env.BITBUCKET_BRANCH = 'develop';
      process.env.BITBUCKET_PR_ID = '55';
      process.env.BITBUCKET_WORKSPACE = 'myworkspace';
      process.env.BITBUCKET_REPO_SLUG = 'myrepo';

      const { extractBitbucketContext } = require('../lib/git-context.js');
      const context = extractBitbucketContext();

      expect(context.commitSha).toBe('bb-commit-sha');
      expect(context.branch).toBe('develop');
      expect(context.buildId).toBe('100');
      expect(context.prNumber).toBe(55);
      expect(context.buildUrl).toBe('https://bitbucket.org/myworkspace/myrepo/pipelines/results/100');
      expect(context.commitUrl).toBe('https://bitbucket.org/myworkspace/myrepo/commits/bb-commit-sha');
    });

    test('handles Bitbucket without workspace/repo slug', () => {
      process.env.BITBUCKET_BUILD_NUMBER = '200';
      process.env.BITBUCKET_COMMIT = 'bb-sha-only';
      process.env.BITBUCKET_BRANCH = 'feature';
      // No BITBUCKET_WORKSPACE, no BITBUCKET_REPO_SLUG

      const { extractBitbucketContext } = require('../lib/git-context.js');
      const context = extractBitbucketContext();

      expect(context.commitSha).toBe('bb-sha-only');
      expect(context.branch).toBe('feature');
      expect(context.buildId).toBe('200');
      expect(context.buildUrl).toBeUndefined();
      expect(context.commitUrl).toBeUndefined();
    });
  });

  describe('extractCircleCIContext()', () => {
    test('returns empty object when not in CircleCI', () => {
      const { extractCircleCIContext } = require('../lib/git-context.js');
      expect(extractCircleCIContext()).toEqual({});
    });

    test('extracts all CircleCI fields', () => {
      process.env.CIRCLECI = 'true';
      process.env.CIRCLE_SHA1 = 'circle-sha-456';
      process.env.CIRCLE_BRANCH = 'circle-branch';
      process.env.CIRCLE_BUILD_NUM = '789';
      process.env.CIRCLE_BUILD_URL = 'https://circleci.com/gh/org/repo/789';
      process.env.CIRCLE_PR_NUMBER = '33';

      const { extractCircleCIContext } = require('../lib/git-context.js');
      const context = extractCircleCIContext();

      expect(context.commitSha).toBe('circle-sha-456');
      expect(context.branch).toBe('circle-branch');
      expect(context.buildId).toBe('789');
      expect(context.buildUrl).toBe('https://circleci.com/gh/org/repo/789');
      expect(context.prNumber).toBe(33);
    });

    test('handles CircleCI without PR number', () => {
      process.env.CIRCLECI = 'true';
      process.env.CIRCLE_SHA1 = 'circle-sha-no-pr';
      process.env.CIRCLE_BRANCH = 'main';
      // No CIRCLE_PR_NUMBER

      const { extractCircleCIContext } = require('../lib/git-context.js');
      const context = extractCircleCIContext();

      expect(context.commitSha).toBe('circle-sha-no-pr');
      expect(context.branch).toBe('main');
      expect(context.prNumber).toBeUndefined();
    });
  });

  describe('extractLocalGitContext()', () => {
    test('extracts commit SHA from git', () => {
      jest.resetModules();
      jest.doMock('child_process', () => ({
        execSync: jest.fn((cmd) => {
          if (cmd === 'git rev-parse HEAD') {
            return 'local-commit-sha-123\n';
          }
          if (cmd === 'git branch --show-current') {
            return 'local-branch\n';
          }
          return '';
        }),
      }));

      const { extractLocalGitContext } = require('../lib/git-context.js');
      const context = extractLocalGitContext();

      expect(context.commitSha).toBe('local-commit-sha-123');
      expect(context.branch).toBe('local-branch');
    });

    test('falls back to rev-parse --abbrev-ref when branch --show-current fails', () => {
      jest.resetModules();
      jest.doMock('child_process', () => ({
        execSync: jest.fn((cmd) => {
          if (cmd === 'git rev-parse HEAD') {
            return 'sha123\n';
          }
          if (cmd === 'git branch --show-current') {
            return ''; // Empty for older git or detached HEAD
          }
          if (cmd === 'git rev-parse --abbrev-ref HEAD') {
            return 'fallback-branch\n';
          }
          return '';
        }),
      }));

      const { extractLocalGitContext } = require('../lib/git-context.js');
      const context = extractLocalGitContext();

      expect(context.branch).toBe('fallback-branch');
    });

    test('handles detached HEAD state', () => {
      jest.resetModules();
      jest.doMock('child_process', () => ({
        execSync: jest.fn((cmd) => {
          if (cmd === 'git rev-parse HEAD') {
            return 'detached-sha\n';
          }
          if (cmd === 'git branch --show-current') {
            return '';
          }
          if (cmd === 'git rev-parse --abbrev-ref HEAD') {
            return 'HEAD\n'; // Detached HEAD returns "HEAD"
          }
          return '';
        }),
      }));

      const { extractLocalGitContext } = require('../lib/git-context.js');
      const context = extractLocalGitContext();

      expect(context.commitSha).toBe('detached-sha');
      expect(context.branch).toBeUndefined();
    });

    test('handles git command failures gracefully', () => {
      jest.resetModules();
      jest.doMock('child_process', () => ({
        execSync: jest.fn(() => {
          throw new Error('git command failed');
        }),
      }));

      const { extractLocalGitContext } = require('../lib/git-context.js');
      const context = extractLocalGitContext();

      expect(context).toEqual({});
    });
  });

  describe('readPRNumberFromGitHubEvent()', () => {
    test('returns null for null/undefined path', () => {
      const { readPRNumberFromGitHubEvent } = require('../lib/git-context.js');
      expect(readPRNumberFromGitHubEvent(null)).toBeNull();
      expect(readPRNumberFromGitHubEvent(undefined)).toBeNull();
    });

    test('returns null for non-string path', () => {
      const { readPRNumberFromGitHubEvent } = require('../lib/git-context.js');
      expect(readPRNumberFromGitHubEvent(123)).toBeNull();
    });

    test('returns null for non-existent file', () => {
      const { readPRNumberFromGitHubEvent } = require('../lib/git-context.js');
      expect(readPRNumberFromGitHubEvent('/non/existent/path.json')).toBeNull();
    });

    test('returns PR number from pull_request.number', () => {
      const eventPath = path.join(__dirname, 'fixtures', 'github-event-pr.json');
      fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 789 } }));

      const { readPRNumberFromGitHubEvent } = require('../lib/git-context.js');
      expect(readPRNumberFromGitHubEvent(eventPath)).toBe(789);

      fs.unlinkSync(eventPath);
    });

    test('returns PR number from top-level number field', () => {
      const eventPath = path.join(__dirname, 'fixtures', 'github-event-issue.json');
      fs.writeFileSync(eventPath, JSON.stringify({ number: 101 }));

      const { readPRNumberFromGitHubEvent } = require('../lib/git-context.js');
      expect(readPRNumberFromGitHubEvent(eventPath)).toBe(101);

      fs.unlinkSync(eventPath);
    });

    test('returns null for invalid JSON', () => {
      const eventPath = path.join(__dirname, 'fixtures', 'github-event-invalid.json');
      fs.writeFileSync(eventPath, 'not valid json');

      const { readPRNumberFromGitHubEvent } = require('../lib/git-context.js');
      expect(readPRNumberFromGitHubEvent(eventPath)).toBeNull();

      fs.unlinkSync(eventPath);
    });

    test('returns null when number is not positive', () => {
      const eventPath = path.join(__dirname, 'fixtures', 'github-event-zero.json');
      fs.writeFileSync(eventPath, JSON.stringify({ number: 0 }));

      const { readPRNumberFromGitHubEvent } = require('../lib/git-context.js');
      expect(readPRNumberFromGitHubEvent(eventPath)).toBeNull();

      fs.unlinkSync(eventPath);
    });

    test('returns null when number is not a number', () => {
      const eventPath = path.join(__dirname, 'fixtures', 'github-event-string.json');
      fs.writeFileSync(eventPath, JSON.stringify({ number: 'not-a-number' }));

      const { readPRNumberFromGitHubEvent } = require('../lib/git-context.js');
      expect(readPRNumberFromGitHubEvent(eventPath)).toBeNull();

      fs.unlinkSync(eventPath);
    });
  });

  describe('sanitizeBranchName()', () => {
    test('returns empty string for null/undefined', () => {
      const { sanitizeBranchName } = require('../lib/git-context.js');
      expect(sanitizeBranchName(null)).toBe('');
      expect(sanitizeBranchName(undefined)).toBe('');
    });

    test('returns empty string for non-string input', () => {
      const { sanitizeBranchName } = require('../lib/git-context.js');
      expect(sanitizeBranchName(123)).toBe('');
    });

    test('preserves valid branch names', () => {
      const { sanitizeBranchName } = require('../lib/git-context.js');
      expect(sanitizeBranchName('main')).toBe('main');
      expect(sanitizeBranchName('feature/my-branch')).toBe('feature/my-branch');
      expect(sanitizeBranchName('release-1.0.0')).toBe('release-1.0.0');
    });

    test('replaces invalid characters with hyphens', () => {
      const { sanitizeBranchName } = require('../lib/git-context.js');
      expect(sanitizeBranchName('feature branch')).toBe('feature-branch');
      expect(sanitizeBranchName('feature@branch')).toBe('feature-branch');
      expect(sanitizeBranchName('feature#branch')).toBe('feature-branch');
    });
  });

  describe('normalizeContext()', () => {
    test('fills missing fields with null', () => {
      const { normalizeContext } = require('../lib/git-context.js');
      const result = normalizeContext({});

      expect(result).toEqual({
        commitSha: null,
        branch: null,
        buildUrl: null,
        buildId: null,
        prNumber: null,
        commitUrl: null,
      });
    });

    test('preserves existing values', () => {
      const { normalizeContext } = require('../lib/git-context.js');
      const result = normalizeContext({
        commitSha: 'abc123',
        branch: 'main',
        buildUrl: 'https://example.com',
      });

      expect(result.commitSha).toBe('abc123');
      expect(result.branch).toBe('main');
      expect(result.buildUrl).toBe('https://example.com');
      expect(result.buildId).toBeNull();
    });

    test('sanitizes branch name', () => {
      const { normalizeContext } = require('../lib/git-context.js');
      const result = normalizeContext({
        branch: 'feature branch',
      });

      expect(result.branch).toBe('feature-branch');
    });
  });

  describe('extractCIContext()', () => {
    test('detects GitHub Actions', () => {
      process.env.GITHUB_ACTIONS = 'true';

      const { extractCIContext } = require('../lib/git-context.js');
      expect(extractCIContext()).toEqual({ provider: 'github', isCI: true });
    });

    test('detects GitLab CI', () => {
      process.env.GITLAB_CI = 'true';

      const { extractCIContext } = require('../lib/git-context.js');
      expect(extractCIContext()).toEqual({ provider: 'gitlab', isCI: true });
    });

    test('detects Bitbucket Pipelines', () => {
      process.env.BITBUCKET_BUILD_NUMBER = '1';

      const { extractCIContext } = require('../lib/git-context.js');
      expect(extractCIContext()).toEqual({ provider: 'bitbucket', isCI: true });
    });

    test('detects CircleCI', () => {
      process.env.CIRCLECI = 'true';

      const { extractCIContext } = require('../lib/git-context.js');
      expect(extractCIContext()).toEqual({ provider: 'circleci', isCI: true });
    });

    test('detects unknown CI when only CI env var is set', () => {
      process.env.CI = 'true';

      const { extractCIContext } = require('../lib/git-context.js');
      expect(extractCIContext()).toEqual({ provider: 'unknown', isCI: true });
    });

    test('returns no CI when not in CI environment', () => {
      const { extractCIContext } = require('../lib/git-context.js');
      expect(extractCIContext()).toEqual({ provider: null, isCI: false });
    });
  });

  describe('execGitCommand()', () => {
    test('returns trimmed output on success', () => {
      jest.resetModules();
      jest.doMock('child_process', () => ({
        execSync: jest.fn(() => '  result with whitespace  \n'),
      }));

      const { execGitCommand } = require('../lib/git-context.js');
      expect(execGitCommand('git status')).toBe('result with whitespace');
    });

    test('returns null on failure', () => {
      jest.resetModules();
      jest.doMock('child_process', () => ({
        execSync: jest.fn(() => {
          throw new Error('command failed');
        }),
      }));

      const { execGitCommand } = require('../lib/git-context.js');
      expect(execGitCommand('git status')).toBeNull();
    });
  });
});
