const { runLocalImageProcessing } = require('../lib/localImageProcessing');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock global fetch for all API calls
const originalFetch = global.fetch;

describe('runLocalImageProcessing', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-local-test-'));
    // Create test images
    fs.writeFileSync(path.join(tmpDir, 'home.png'), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(tmpDir, 'settings.jpg'), Buffer.from([255, 216, 255]));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when directory has no images', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-empty-'));
    fs.writeFileSync(path.join(emptyDir, 'readme.txt'), 'text');

    await expect(runLocalImageProcessing({
      dir: emptyDir,
      project: 'test',
      openaiApiKey: 'sk-test',
      jinaApiKey: 'jina-test',
      milvusAddress: 'https://milvus.test',
      milvusToken: 'tok',
      milvusCollection: 'col',
    })).rejects.toThrow('No image files');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('runs the full local pipeline end-to-end', async () => {
    const fetchCalls = [];

    global.fetch = jest.fn(async (url, options) => {
      fetchCalls.push({ url, method: options?.method || 'GET' });

      // OpenAI vision API
      if (url === 'https://api.openai.com/v1/chat/completions') {
        const body = JSON.parse(options.body);
        const imageCount = body.messages[0].content.filter(c => c.type === 'image_url').length;
        let components = '';
        for (let i = 1; i <= imageCount; i++) {
          components += `<component-${i}>
            <screen-name>Screen ${i}</screen-name>
            <description>A test screen ${i}.</description>
            <tags><tag>Test</tag><tag>UI</tag></tags>
            <search-queries><query>test screen ${i}</query></search-queries>
          </component-${i}>`;
        }

        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: `<batch-analysis>${components}</batch-analysis>`,
              },
            }],
          }),
        };
      }

      // Jina embeddings API
      if (url === 'https://api.jina.ai/v1/embeddings') {
        const body = JSON.parse(options.body);
        const embeddings = body.input.map(() => ({
          embedding: new Array(1024).fill(0.5),
        }));
        return {
          ok: true,
          json: async () => ({ data: embeddings }),
        };
      }

      // Milvus insert API
      if (url.includes('/v2/vectordb/entities/insert')) {
        const body = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: { insertCount: body.data.length },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await runLocalImageProcessing({
      dir: tmpDir,
      project: 'test-project',
      openaiApiKey: 'sk-test',
      jinaApiKey: 'jina-test',
      milvusAddress: 'https://milvus.test',
      milvusToken: 'tok',
      milvusCollection: 'my-collection',
      verbose: false,
    });

    expect(result.projectId).toBe('test-project');
    expect(result.totalImages).toBe(2);
    expect(result.processedImages).toBe(2);
    expect(result.failedImages).toBe(0);
    expect(result.status).toBe('completed');
    expect(result.uploadId).toMatch(/^local-/);

    // Verify API calls happened
    const openaiCalls = fetchCalls.filter(c => c.url.includes('openai'));
    const jinaCalls = fetchCalls.filter(c => c.url.includes('jina'));
    const milvusCalls = fetchCalls.filter(c => c.url.includes('milvus'));

    expect(openaiCalls.length).toBeGreaterThanOrEqual(1);
    expect(jinaCalls.length).toBeGreaterThanOrEqual(2); // image + text embeddings
    expect(milvusCalls.length).toBeGreaterThanOrEqual(1);

    // Verify Milvus insert data
    const milvusCall = fetchCalls.find(c => c.url.includes('milvus'));
    expect(milvusCall).toBeTruthy();
  });

  it('includes source_type upload in Milvus records', async () => {
    let milvusBody = null;

    global.fetch = jest.fn(async (url, options) => {
      if (url === 'https://api.openai.com/v1/chat/completions') {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: `<batch-analysis>
                  <component-1><screen-name>Home</screen-name><description>Home screen.</description><tags><tag>Home</tag></tags><search-queries><query>home</query></search-queries></component-1>
                  <component-2><screen-name>Settings</screen-name><description>Settings screen.</description><tags><tag>Settings</tag></tags><search-queries><query>settings</query></search-queries></component-2>
                </batch-analysis>`,
              },
            }],
          }),
        };
      }

      if (url === 'https://api.jina.ai/v1/embeddings') {
        const body = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            data: body.input.map(() => ({ embedding: new Array(1024).fill(0.1) })),
          }),
        };
      }

      if (url.includes('/v2/vectordb/entities/insert')) {
        milvusBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ code: 0, data: { insertCount: milvusBody.data.length } }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await runLocalImageProcessing({
      dir: tmpDir,
      project: 'proj',
      openaiApiKey: 'sk-test',
      jinaApiKey: 'jina-test',
      milvusAddress: 'https://milvus.test',
      milvusToken: 'tok',
      milvusCollection: 'col',
    });

    expect(milvusBody).toBeTruthy();
    expect(milvusBody.collectionName).toBe('col');
    expect(milvusBody.data).toHaveLength(2);

    for (const record of milvusBody.data) {
      expect(record.json_content.source_type).toBe('upload');
      expect(record.text_embedding).toHaveLength(2048);
      expect(record.image_embedding).toHaveLength(2048);
      expect(record.project_id).toBe('proj');
    }

    expect(milvusBody.data[0].component_name).toBe('Home');
    expect(milvusBody.data[1].component_name).toBe('Settings');
  });
});
