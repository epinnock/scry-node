const fs = require('fs');
const path = require('path');
const os = require('os');
const { findImageFiles } = require('../lib/imageUpload');

describe('findImageFiles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds png, jpg, and jpeg files', () => {
    fs.writeFileSync(path.join(tmpDir, 'screen1.png'), 'fake-png');
    fs.writeFileSync(path.join(tmpDir, 'screen2.jpg'), 'fake-jpg');
    fs.writeFileSync(path.join(tmpDir, 'screen3.jpeg'), 'fake-jpeg');

    const files = findImageFiles(tmpDir);
    expect(files).toHaveLength(3);
    expect(files.map(f => path.basename(f)).sort()).toEqual(['screen1.png', 'screen2.jpg', 'screen3.jpeg']);
  });

  it('finds images in nested directories', () => {
    const subDir = path.join(tmpDir, 'screens', 'mobile');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'home.png'), 'data');

    const files = findImageFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('home.png');
  });

  it('returns empty array for directory with no images', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'text');
    fs.writeFileSync(path.join(tmpDir, 'data.json'), '{}');

    const files = findImageFiles(tmpDir);
    expect(files).toHaveLength(0);
  });

  it('skips __MACOSX directories', () => {
    const macDir = path.join(tmpDir, '__MACOSX');
    fs.mkdirSync(macDir);
    fs.writeFileSync(path.join(macDir, '._screen.png'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'screen.png'), 'real');

    const files = findImageFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(path.basename(files[0])).toBe('screen.png');
  });

  it('skips hidden files and directories', () => {
    const hiddenDir = path.join(tmpDir, '.hidden');
    fs.mkdirSync(hiddenDir);
    fs.writeFileSync(path.join(hiddenDir, 'secret.png'), 'data');
    fs.writeFileSync(path.join(tmpDir, '.dotfile.png'), 'data');
    fs.writeFileSync(path.join(tmpDir, 'visible.png'), 'data');

    const files = findImageFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(path.basename(files[0])).toBe('visible.png');
  });
});
