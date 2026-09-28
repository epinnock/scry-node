/**
 * `scry capture rn` against a fake device + fake Storybook channel: the bundle it writes is
 * validator-clean, counts are honest, a story that never settles is skipped with reason
 * `timeout`, and nothing links to a live Storybook (G5).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encodePng, decodePng } = require('../lib/capture/png.js');
const { captureStories, buildRnManifest, runCaptureRn, boundedTree, captureKind } = require('../lib/capture/rn.js');
const { validateBundle } = require('../lib/scf.js');
const { findTestIdBounds } = require('../lib/capture/android.js');

const quietLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), debug: jest.fn() });

function solidPng(width, height, rgba) {
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
    return encodePng({ width, height, data });
}

const STORIES = [
    { id: 'components-button--primary', title: 'Components/Button', name: 'Primary', importPath: './src/components/Button.stories.tsx' },
    { id: 'screens-menu--default', title: 'Screens/Menu', name: 'Default', importPath: './src/screens/Menu.stories.tsx' },
    { id: 'components-map--default', title: 'Components/Map', name: 'Default', importPath: './src/components/Map.stories.tsx' },
];

function fakeDevice({ frames } = {}) {
    let n = 0;
    return {
        name: 'Pixel 6',
        os: 'Android 14',
        scale: 2,
        method: 'emulator',
        screenshot: jest.fn(() => (frames ? frames[n++ % frames.length] : solidPng(40, 80, [250, 248, 244, 255]))),
        findRootBounds: jest.fn(() => ({ x: 0, y: 10, width: 40, height: 60 })),
        connect: jest.fn(async () => {}),
        makeDeterministic: jest.fn(),
        reversePorts: jest.fn(),
        isInstalled: jest.fn(() => true),
        install: jest.fn(),
        launch: jest.fn(),
        cleanup: jest.fn(),
    };
}

function fakeChannel({ neverRenders = [] } = {}) {
    const tree = {
        type: 'Pressable', testId: 'scry-root', role: 'button',
        bounds: { x: 0, y: 0, width: 20, height: 30 },
        style: { background: '#3B2A20', cornerRadius: 12 },
        children: [{ type: 'Text', text: 'Add to order', bounds: { x: 2, y: 5, width: 16, height: 10 }, style: { color: '#FFFFFF', fontSize: 16, fontWeight: 600 } }],
    };
    return {
        lastRendered: null,
        selectStory: jest.fn(async (id) => !neverRenders.includes(id)),
        requestTree: jest.fn(async (id) => ({ requestId: 'r', storyId: id, scale: 2, rootBounds: { x: 0, y: 5, width: 20, height: 30 }, tree })),
        fetchIndex: jest.fn(async () => ({ v: 5, entries: Object.fromEntries(STORIES.map((s) => [s.id, { ...s, type: 'story' }])) })),
        waitForServer: jest.fn(async function () { return this.fetchIndex(); }),
        connect: jest.fn(async () => {}),
        waitFor: jest.fn(async () => ({ type: 'storyRendered', args: ['components-button--primary'] })),
        close: jest.fn(),
    };
}

function tmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'scry-rn-test-'));
}

describe('capture rn', () => {
    test('writes a validator-clean storybook-rn bundle with crops, trees and honest counts', async () => {
        const outDir = tmp();
        const projectDir = tmp();
        fs.mkdirSync(path.join(projectDir, 'src/components'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'src/components/Button.tsx'), 'export const Button = () => null;\n');
        const device = fakeDevice();
        const channel = fakeChannel({ neverRenders: ['components-map--default'] });

        const { captures, skipped, scale } = await captureStories({
            device, channel, stories: STORIES, outDir, projectDir, logger: quietLogger(), settleTimeoutMs: 2000, frameIntervalMs: 5,
        });
        const manifest = buildRnManifest({ platform: 'android', device, scale, captures, skipped, declared: STORIES.length, toolVersion: '0.0.0-test' });
        fs.writeFileSync(path.join(outDir, 'scf.json'), JSON.stringify(manifest));

        const result = validateBundle(outDir);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);

        expect(manifest.source).toMatchObject({ kind: 'storybook-rn', platform: 'android', framework: 'react-native' });
        expect(manifest.defaults.capture).toEqual({ method: 'emulator', device: { name: 'Pixel 6', os: 'Android 14' }, scale: 2 });
        expect(manifest.counts).toEqual({
            declared: 3,
            captured: 2,
            skipped: [{ id: 'components-map--default', reason: 'timeout', detail: 'no storyRendered within 2 s' }],
        });
        const [button, menu] = manifest.captures;
        expect(button).toMatchObject({
            id: 'components-button--primary', kind: 'component', title: ['Components', 'Button'], name: 'Primary',
            code: { file: 'src/components/Button.stories.tsx', componentFile: 'src/components/Button.tsx' },
            capture: { size: { width: 40, height: 60 }, crop: 'root' },
            structure: { file: 'structure/0001.json', origin: 'rn-fiber', format: 'scf-tree/1' },
        });
        expect(menu.kind).toBe('screen');
        expect(menu.code).toEqual({ file: 'src/screens/Menu.stories.tsx' });
        // G5: no live Storybook link on any native capture.
        for (const c of manifest.captures) expect(c.links).toBeUndefined();
        // The crop is the uiautomator rectangle.
        const img = decodePng(fs.readFileSync(path.join(outDir, button.image)));
        expect([img.width, img.height]).toEqual([40, 60]);
        const tree = JSON.parse(fs.readFileSync(path.join(outDir, button.structure.file), 'utf8'));
        expect(tree).toMatchObject({ format: 'scf-tree/1', units: 'pt', root: { type: 'Pressable', children: [{ text: 'Add to order' }] } });
    });

    test('a story whose screen never stops changing is skipped with reason timeout', async () => {
        const outDir = tmp();
        const frames = [solidPng(8, 8, [0, 0, 0, 255]), solidPng(8, 8, [255, 255, 255, 255])];
        const device = fakeDevice({ frames });
        device.findRootBounds = () => null;
        const { captures, skipped } = await captureStories({
            device, channel: fakeChannel(), stories: STORIES.slice(0, 1), outDir, projectDir: outDir,
            logger: quietLogger(), settleTimeoutMs: 120, frameIntervalMs: 10,
        });
        expect(captures).toEqual([]);
        expect(skipped).toEqual([{ id: 'components-button--primary', reason: 'timeout', detail: 'no two identical frames within 0.12 s' }]);
    });

    test('an app without the Scry probe: no trees, crop from the platform, probe asked once', async () => {
        const outDir = tmp();
        const channel = fakeChannel();
        channel.requestTree = jest.fn(async () => null);
        const { captures } = await captureStories({
            device: fakeDevice(), channel, stories: STORIES.slice(0, 2), outDir, projectDir: outDir,
            logger: quietLogger(), settleTimeoutMs: 1000, frameIntervalMs: 5,
        });
        expect(captures).toHaveLength(2);
        expect(captures.every((c) => !c.structure && c.capture.crop === 'root')).toBe(true);
        expect(channel.requestTree).toHaveBeenCalledTimes(1);
    });

    test('runCaptureRn end to end with fakes: exit 0, scf.json on disk, device cleaned up', async () => {
        const projectDir = tmp();
        fs.writeFileSync(path.join(projectDir, 'app.json'), JSON.stringify({ expo: { android: { package: 'com.example.app' } } }));
        const device = fakeDevice();
        const channel = fakeChannel();
        const out = path.join(projectDir, '.scry', 'capture');
        const res = await runCaptureRn(
            { platform: 'android', device: 'Pixel_6_API_34', projectDir, out, settleTimeout: 1000 },
            { logger: quietLogger(), toolVersion: '9.9.9', deps: { device, channel } }
        );
        expect(res.exitCode).toBe(0);
        expect(res.validation.ok).toBe(true);
        expect(device.launch).toHaveBeenCalledWith('com.example.app');
        expect(device.cleanup).toHaveBeenCalled();
        expect(channel.close).toHaveBeenCalled();
        const manifest = JSON.parse(fs.readFileSync(path.join(out, 'scf.json'), 'utf8'));
        expect(manifest.counts.captured).toBe(3);
        expect(manifest.source.tool).toEqual({ name: '@scrymore/scry-deployer capture rn', version: '9.9.9' });
        expect(fs.existsSync(path.join(out, 'metro.log'))).toBe(false);
    });

    test('structure trees are capped at 5000 nodes', () => {
        const root = { type: 'View', children: Array.from({ length: 6000 }, (_, i) => ({ type: 'Text', text: `n${i}` })) };
        const doc = boundedTree(root);
        const count = (n) => 1 + (n.children || []).reduce((a, c) => a + count(c), 0);
        expect(count(doc.root)).toBe(5000);
    });

    test('kind from the title, uiautomator bounds from resource-id', () => {
        expect(captureKind('Screens/Order')).toBe('screen');
        expect(captureKind('Components/Button')).toBe('component');
        const xml = '<hierarchy><node resource-id="" bounds="[0,0][1080,2400]"/><node resource-id="scry-root" class="android.view.ViewGroup" bounds="[28,110][1052,2325]"/></hierarchy>';
        expect(findTestIdBounds(xml, 'scry-root')).toEqual({ x: 28, y: 110, width: 1024, height: 2215 });
    });
});
