const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock @octokit/rest before requiring module under test
const createOctokitMock = () => {
  const issues = {
    listComments: jest.fn(),
    createComment: jest.fn(),
    updateComment: jest.fn(),
  };

  return {
    issues,
    Octokit: jest.fn(() => ({
      rest: { issues },
    })),
  };
};

describe('lib/pr-comment', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();

    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_REPOSITORY;
  });

  test('formatPRComment() includes marker and view link', () => {
    const { formatPRComment, COMMENT_MARKER } = require('../lib/pr-comment.js');

    const body = formatPRComment({ viewUrl: 'https://view.example.com/p/v/' }, null);

    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain('View Storybook');
    expect(body).toContain('https://view.example.com/p/v/');
  });

  test('formatPRComment() includes coverage table when coverageSummary present', () => {
    const { formatPRComment } = require('../lib/pr-comment.js');

    const body = formatPRComment(
      { viewUrl: 'https://view.example.com/p/v/', coverageUrl: 'https://r2.example.com/cov.json' },
      {
        summary: {
          componentCoverage: 90,
          propCoverage: 80,
          variantCoverage: 70,
          passRate: 99.9,
        },
        qualityGate: { passed: false },
      }
    );

    expect(body).toContain('## Coverage Report');
    expect(body).toContain('Component Coverage');
    expect(body).toContain('90.0%');
    expect(body).toContain('FAILED');
    expect(body).toContain('View Coverage Report');
  });

  test('postPRComment() is no-op without GITHUB_TOKEN', async () => {
    jest.doMock('@octokit/rest', () => createOctokitMock());
    const { postPRComment } = require('../lib/pr-comment.js');

    await expect(postPRComment({ viewUrl: 'x' }, null)).resolves.toBeUndefined();
  });

  test('postPRComment() creates comment when no existing marker comment', async () => {
    const octokitMock = createOctokitMock();
    octokitMock.issues.listComments.mockResolvedValue({ data: [] });
    octokitMock.issues.createComment.mockResolvedValue({});

    jest.doMock('@octokit/rest', () => ({ Octokit: octokitMock.Octokit }));

    const eventPath = path.join(os.tmpdir(), `scry-event-${Date.now()}.json`);
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 123 } }));

    process.env.GITHUB_TOKEN = 'tkn';
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const { postPRComment, COMMENT_MARKER } = require('../lib/pr-comment.js');

    await postPRComment({ viewUrl: 'https://view' }, null);

    expect(octokitMock.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        issue_number: 123,
        body: expect.stringContaining(COMMENT_MARKER),
      })
    );

    fs.unlinkSync(eventPath);
  });

  test('postPRComment() updates comment when existing marker comment found', async () => {
    const octokitMock = createOctokitMock();
    octokitMock.issues.listComments.mockResolvedValue({ data: [{ id: 999, body: '<!-- scry-deployer --> old' }] });
    octokitMock.issues.updateComment.mockResolvedValue({});

    jest.doMock('@octokit/rest', () => ({ Octokit: octokitMock.Octokit }));

    const eventPath = path.join(os.tmpdir(), `scry-event-${Date.now()}.json`);
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 123 } }));

    process.env.GITHUB_TOKEN = 'tkn';
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    const { postPRComment } = require('../lib/pr-comment.js');

    await postPRComment({ viewUrl: 'https://view' }, null);

    expect(octokitMock.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        comment_id: 999,
        body: expect.any(String),
      })
    );

    fs.unlinkSync(eventPath);
  });
});
