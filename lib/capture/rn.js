/**
 * `scry capture rn` — capture every React Native Storybook story on a simulator/emulator
 * into an SCF 1.0 bundle (source.kind storybook-rn).
 *
 * Flow: Metro with STORYBOOK_ENABLED=true (entry-point swap, so the app shows on-device
 * Storybook) → device ready and deterministic → app launched → story list from the channel
 * server's /index.json → for each story: setCurrentStory over the websocket, wait for
 * storyRendered, wait until two consecutive frames are identical (10 s budget, else
 * skipped:timeout), crop to the `scry-root` testID, ask the app's optional dev-only probe for
 * an rn-fiber structure tree → scf.json with honest counts, validated with the vendored
 * validator. `links.live` is never set: there is no live Storybook for a native capture (G5).
 */
const fs = require('fs');
const path = require('path');
const { StorybookChannel, storiesFromIndex } = require('./storybookChannel.js');
const { decodePng, encodePng, cropImage, samePixels, pngSize } = require('./png.js');
const exec = require('./exec.js');
const { SCF_SCHEMA_URL, validateBundle, printValidation } = require('../scf.js');

const ROOT_TEST_ID = 'scry-root';
const DEFAULT_SETTLE_TIMEOUT_MS = 10000;
const DEFAULT_FRAME_INTERVAL_MS = 400;
const STRUCTURE_MAX_BYTES = 2 * 1024 * 1024;
const STRUCTURE_MAX_NODES = 5000;

function readJsonIfExists(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The app id from --app-id, else Expo's app.json (android.package / ios.bundleIdentifier). */
function resolveAppId(platform, projectDir, explicit) {
    if (explicit) return explicit;
    const appJson = readJsonIfExists(path.join(projectDir, 'app.json'));
    const expo = (appJson && (appJson.expo || appJson)) || {};
    const id = platform === 'android' ? expo.android && expo.android.package : expo.ios && expo.ios.bundleIdentifier;
    if (!id) throw new Error(`No --app-id given and app.json has no ${platform === 'android' ? 'expo.android.package' : 'expo.ios.bundleIdentifier'}.`);
    return id;
}

function captureKind(title) {
    const first = String(title || '').split('/')[0].trim();
    return /^(screens?|pages?)$/i.test(first) ? 'screen' : 'component';
}

/** `./src/components/Button.stories.tsx` -> `src/components/Button.tsx` when that file exists. */
function guessComponentFile(importPath, projectDir) {
    if (!importPath) return null;
    const rel = importPath.replace(/^\.\//, '');
    const candidate = rel.replace(/\.stories(\.[jt]sx?)$/, '$1');
    if (candidate === rel) return null;
    return fs.existsSync(path.join(projectDir, candidate)) ? candidate : null;
}

function countNodes(node) {
    if (!node || typeof node !== 'object') return 0;
    return 1 + (Array.isArray(node.children) ? node.children.reduce((n, c) => n + countNodes(c), 0) : 0);
}

/** Keep the first `budget` nodes in depth-first order. */
function truncateTree(node, budget) {
    let left = budget;
    const walk = (n) => {
        if (left <= 0) return null;
        left--;
        const { children, ...rest } = n;
        if (Array.isArray(children) && children.length) {
            const kept = [];
            for (const c of children) {
                const k = walk(c);
                if (!k) break;
                kept.push(k);
            }
            if (kept.length) rest.children = kept;
        }
        return rest;
    };
    return walk(node);
}

/** Move tree bounds from root-relative points to image-relative points. */
function offsetTree(node, dx, dy) {
    if (!node || (!dx && !dy)) return node;
    const out = { ...node };
    if (node.bounds) out.bounds = { ...node.bounds, x: node.bounds.x + dx, y: node.bounds.y + dy };
    if (Array.isArray(node.children)) out.children = node.children.map((c) => offsetTree(c, dx, dy));
    return out;
}

/** An scf-tree/1 document within 5k nodes / 2 MB, or null. */
function boundedTree(root) {
    if (!root || typeof root.type !== 'string') return null;
    let tree = root;
    let budget = Math.min(STRUCTURE_MAX_NODES, countNodes(root));
    let doc = { format: 'scf-tree/1', units: 'pt', root: truncateTree(tree, budget) };
    let json = JSON.stringify(doc);
    while (Buffer.byteLength(json) > STRUCTURE_MAX_BYTES && budget > 1) {
        budget = Math.floor(budget / 2);
        doc = { format: 'scf-tree/1', units: 'pt', root: truncateTree(tree, budget) };
        json = JSON.stringify(doc);
    }
    return doc;
}

/**
 * Wait for two identical consecutive frames. Returns the frame, or null at the deadline.
 */
async function waitForStableFrame(device, deadline, intervalMs) {
    let prev = device.screenshot();
    while (Date.now() < deadline) {
        await exec.sleep(intervalMs);
        const next = device.screenshot();
        if (samePixels(prev, next)) return next;
        prev = next;
    }
    return null;
}

/**
 * Capture every story into outDir. Pure orchestration over a device + channel, so tests can
 * drive it with fakes.
 *
 * @returns {Promise<{captures:object[], skipped:object[], scale:number}>}
 */
async function captureStories({ device, channel, stories, outDir, projectDir, logger, settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS, frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS, structure = true }) {
    fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
    const captures = [];
    const skipped = [];
    let scale = device.scale;
    let probeAvailable;

    for (let i = 0; i < stories.length; i++) {
        const story = stories[i];
        const started = Date.now();
        const deadline = started + settleTimeoutMs;
        const rendered = await channel.selectStory(story.id, settleTimeoutMs);
        if (!rendered) {
            skipped.push({ id: story.id, reason: 'timeout', detail: `no storyRendered within ${settleTimeoutMs / 1000} s` });
            logger.warn(`  ✗ ${story.id}: skipped (timeout: the story did not render within ${settleTimeoutMs / 1000} s)`);
            continue;
        }
        let frame;
        try {
            frame = await waitForStableFrame(device, deadline, frameIntervalMs);
        } catch (e) {
            skipped.push({ id: story.id, reason: 'error', detail: `screenshot failed: ${e.message}`.slice(0, 300) });
            logger.warn(`  ✗ ${story.id}: skipped (screenshot failed: ${e.message})`);
            continue;
        }
        if (!frame) {
            skipped.push({ id: story.id, reason: 'timeout', detail: `no two identical frames within ${settleTimeoutMs / 1000} s` });
            logger.warn(`  ✗ ${story.id}: skipped (timeout: the screen kept changing for ${settleTimeoutMs / 1000} s)`);
            continue;
        }

        // The app's dev-only probe (crop bounds on iOS + the rn-fiber tree). An app without one
        // never answers; stop asking after the first silence instead of waiting per story.
        const probe = probeAvailable !== false ? await channel.requestTree(story.id).catch(() => null) : null;
        if (probeAvailable === undefined) {
            probeAvailable = Boolean(probe);
            if (!probe) logger.info('  (the app has no Scry probe: no structure trees; crop from the platform only)');
        }
        if (probe && Number(probe.scale) > 0) scale = Number(probe.scale);

        // Crop: uiautomator's pixel bounds (Android) first, else the probe's root bounds × scale.
        let rect = device.findRootBounds ? device.findRootBounds(ROOT_TEST_ID) : null;
        if (!rect && probe && probe.rootBounds) {
            const b = probe.rootBounds;
            rect = { x: b.x * scale, y: b.y * scale, width: b.width * scale, height: b.height * scale };
        }
        let png = frame;
        let crop = 'none';
        let imageOffsetPt = { x: 0, y: 0 };
        if (rect) {
            try {
                const cropped = cropImage(decodePng(frame), rect);
                if (cropped) {
                    png = encodePng(cropped);
                    crop = 'root';
                }
            } catch (e) {
                logger.warn(`  ${story.id}: kept the full screen (could not crop: ${e.message})`);
            }
        } else if (probe && probe.rootBounds) {
            imageOffsetPt = { x: probe.rootBounds.x, y: probe.rootBounds.y };
        }

        const stem = String(i + 1).padStart(4, '0');
        const image = `images/${stem}.png`;
        fs.writeFileSync(path.join(outDir, image), png);
        const size = pngSize(png);

        const capture = {
            id: story.id,
            image,
            kind: captureKind(story.title),
            title: String(story.title || '').split('/').filter(Boolean),
            name: story.name,
            capture: { size, crop },
            links: {},
        };
        const file = story.importPath ? story.importPath.replace(/^\.\//, '') : null;
        const componentFile = guessComponentFile(story.importPath, projectDir);
        if (file || componentFile) {
            capture.code = { ...(file ? { file } : {}), ...(componentFile ? { componentFile } : {}) };
        }

        if (structure && probe && probe.tree) {
            const doc = boundedTree(crop === 'root' ? probe.tree : offsetTree(probe.tree, imageOffsetPt.x, imageOffsetPt.y));
            if (doc) {
                fs.mkdirSync(path.join(outDir, 'structure'), { recursive: true });
                const structurePath = `structure/${stem}.json`;
                fs.writeFileSync(path.join(outDir, structurePath), JSON.stringify(doc));
                capture.structure = { file: structurePath, origin: 'rn-fiber', format: 'scf-tree/1' };
            }
        }
        captures.push(capture);
        logger.info(`  ✓ ${story.id} (${size.width}×${size.height}, crop ${crop}${capture.structure ? ', tree' : ''}, ${Date.now() - started} ms)`);
    }
    return { captures, skipped, scale };
}

/** The manifest for a finished run. Pure; exported for tests. */
function buildRnManifest({ platform, device, scale, captures, skipped, declared, toolVersion, gitContext = {} }) {
    const hasRepo = gitContext.commitSha || gitContext.branch || gitContext.repository;
    // `links` is left out entirely: no live Storybook exists for a device capture (G5).
    const cleanCaptures = captures.map(({ links, ...c }) => c);
    return {
        $schema: SCF_SCHEMA_URL,
        scf: '1.0',
        source: {
            kind: 'storybook-rn',
            platform,
            framework: 'react-native',
            tool: { name: '@scrymore/scry-deployer capture rn', version: toolVersion },
            device: { name: device.name, os: device.os },
        },
        ...(hasRepo ? { repository: { ...(gitContext.repository ? { url: gitContext.repository } : {}), ...(gitContext.commitSha ? { commit: gitContext.commitSha } : {}), ...(gitContext.branch ? { branch: gitContext.branch } : {}) } } : {}),
        createdAt: new Date().toISOString(),
        defaults: {
            capture: {
                method: device.method,
                device: { name: device.name, os: device.os },
                scale,
            },
        },
        counts: { declared, captured: cleanCaptures.length, skipped },
        captures: cleanCaptures,
    };
}

function metroCommand(projectDir) {
    const pkg = readJsonIfExists(path.join(projectDir, 'package.json')) || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return deps.expo ? ['npx', ['expo', 'start', '--port', '8081']] : ['npx', ['react-native', 'start', '--port', '8081']];
}

/**
 * The whole command. `ctx.deps` lets tests swap the device, channel, Metro and git context.
 * @returns {Promise<{exitCode:number, outDir:string, manifest?:object, validation?:object}>}
 */
async function runCaptureRn(argv, ctx = {}) {
    const logger = ctx.logger;
    const deps = ctx.deps || {};
    const platform = argv.platform;
    if (platform !== 'android' && platform !== 'ios') throw new Error('--platform must be ios or android');
    const projectDir = path.resolve(argv.projectDir || process.cwd());
    const outDir = path.resolve(argv.out || path.join(projectDir, '.scry', 'capture'));
    const settleTimeoutMs = Number(argv.settleTimeout) > 0 ? Number(argv.settleTimeout) : DEFAULT_SETTLE_TIMEOUT_MS;
    const wsHost = argv.wsHost || '127.0.0.1';
    const wsPort = Number(argv.wsPort) || 7007;

    // A fresh bundle each run: only what this run captured goes in.
    for (const entry of ['scf.json', 'images', 'structure', 'source']) {
        fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
    }
    fs.mkdirSync(outDir, { recursive: true });

    const cleanups = [];
    try {
        const device = deps.device || (platform === 'android'
            ? new (require('./android.js').AndroidDevice)({ deviceName: argv.device, logger })
            : new (require('./ios.js').IosSimulator)({ deviceName: argv.device, logger }));
        cleanups.push(() => device.cleanup());
        await device.connect();
        device.makeDeterministic();
        device.reversePorts([8081, wsPort]);

        const channel = deps.channel || new StorybookChannel({ host: wsHost, port: wsPort });
        cleanups.push(() => channel.close());

        // Metro, unless one already serves the Storybook channel.
        let serverUp = false;
        try { await channel.fetchIndex(); serverUp = true; } catch { serverUp = false; }
        if (!serverUp && argv.metro !== false) {
            const [cmd, args] = metroCommand(projectDir);
            const logFile = path.join(outDir, 'metro.log');
            logger.info(`Starting Metro with STORYBOOK_ENABLED=true (${cmd} ${args.join(' ')}; log ${logFile}) ...`);
            const metro = (deps.startBackground || exec.startBackground)(cmd, args, {
                cwd: projectDir,
                env: { STORYBOOK_ENABLED: 'true', EXPO_PUBLIC_SCRY_CAPTURE: '1', CI: '1', STORYBOOK_WS_PORT: String(wsPort) },
                logFile,
            });
            cleanups.push(() => metro.kill());
        }
        const index = await channel.waitForServer(argv.serverTimeout ? Number(argv.serverTimeout) : 180000);

        const appId = resolveAppId(platform, projectDir, argv.appId);
        if (argv.app) device.install(path.resolve(argv.app));
        else if (!device.isInstalled(appId)) {
            if (!argv.build) throw new Error(`${appId} is not installed on ${device.name}. Pass --app <path to .apk/.app> or --build.`);
            logger.info(`Building and installing ${appId} with STORYBOOK_ENABLED=true (expo run:${platform}) ...`);
            exec.run('npx', ['expo', `run:${platform}`, '--no-bundler', ...(argv.device ? ['--device', argv.device] : [])], {
                cwd: projectDir, env: { STORYBOOK_ENABLED: 'true', EXPO_PUBLIC_SCRY_CAPTURE: '1', CI: '1' }, timeoutMs: 45 * 60 * 1000,
            });
        }
        device.launch(appId);
        // Expo Go / a dev client load the project from a deep link (e.g. exp://127.0.0.1:8081).
        if (argv.openUrl) device.openUrl(argv.openUrl);
        await channel.connect();

        // The app connects to the channel once its bundle has loaded; wait for its first render.
        const firstRender = await channel.waitFor((m) => m && m.type === 'storyRendered', argv.appTimeout ? Number(argv.appTimeout) : 180000);
        if (!firstRender && !channel.lastRendered) logger.warn('The app did not report a rendered story yet; continuing.');

        let stories = storiesFromIndex(index);
        if (argv.stories) {
            const wanted = new Set(String(argv.stories).split(',').map((s) => s.trim()).filter(Boolean));
            stories = stories.filter((s) => wanted.has(s.id));
        }
        logger.info(`Capturing ${stories.length} stories on ${device.name} ...`);

        const { captures, skipped, scale } = await captureStories({
            device, channel, stories, outDir, projectDir, logger, settleTimeoutMs,
            structure: argv.structure !== false,
        });
        const manifest = buildRnManifest({
            platform, device, scale, captures, skipped, declared: stories.length,
            toolVersion: ctx.toolVersion || 'unknown', gitContext: ctx.gitContext || {},
        });
        fs.writeFileSync(path.join(outDir, 'scf.json'), JSON.stringify(manifest, null, 2) + '\n');
        fs.rmSync(path.join(outDir, 'metro.log'), { force: true });

        const validation = (deps.validateBundle || validateBundle)(outDir);
        logger.info(`\n${captures.length} of ${stories.length} stories captured, ${skipped.length} skipped. Bundle: ${outDir}`);
        if (!validation.ok) {
            logger.error('❌ The bundle failed validation:');
            printValidation(validation, logger);
            return { exitCode: 1, outDir, manifest, validation };
        }
        if (validation.warnings && validation.warnings.length) printValidation(validation, logger);
        if (captures.length === 0) {
            logger.error('❌ Nothing was captured.');
            return { exitCode: 1, outDir, manifest, validation };
        }
        logger.success(`✅ Valid SCF bundle. Upload it with: scry upload ${path.relative(process.cwd(), outDir) || '.'} --project <id>`);
        return { exitCode: 0, outDir, manifest, validation };
    } finally {
        for (const fn of cleanups.reverse()) {
            try { await fn(); } catch (e) { logger.debug && logger.debug(`cleanup: ${e.message}`); }
        }
    }
}

module.exports = {
    runCaptureRn,
    captureStories,
    buildRnManifest,
    boundedTree,
    truncateTree,
    guessComponentFile,
    captureKind,
    resolveAppId,
    ROOT_TEST_ID,
    DEFAULT_SETTLE_TIMEOUT_MS,
};
