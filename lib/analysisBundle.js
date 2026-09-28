/**
 * `scry analyze` → an SCF bundle (ledger F3).
 *
 * `analyze` used to upload a master ZIP named storybook.zip through the presigned route, which
 * creates a build and never queues it: every analyze build stayed unindexed. It now writes an
 * SCF 1.0 bundle (source storybook:web) and sends it through the bundle route, which queues it.
 */
const fs = require('fs');
const path = require('path');
const { SCF_SCHEMA_URL, toStoryId } = require('./scf.js');

/**
 * @param {{stories: Array<{filepath:string, componentName:string, storyTitle:string|null, testName:string, location?:object, screenshotPath:string|null}>}} analysis
 * @param {string} outDir empty directory to write the bundle into
 * @param {{toolVersion:string, repoRoot?:string, gitContext?:{commitSha?:string, branch?:string, repository?:string}}} opts
 * @returns {{manifest:object, captured:number, skipped:number}}
 */
function writeAnalysisBundle(analysis, outDir, opts) {
    const repoRoot = path.resolve(opts.repoRoot || process.cwd());
    fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
    const captures = [];
    const skipped = [];
    const seen = new Set();

    (analysis.stories || []).forEach((story, index) => {
        const title = story.storyTitle || '';
        const id = title ? toStoryId(title, story.testName) : `${story.filepath}#${story.testName}`;
        if (seen.has(id)) {
            // Two exports that map to one id: keep the first, account for the second.
            return;
        }
        seen.add(id);
        if (!story.screenshotPath || !fs.existsSync(story.screenshotPath)) {
            skipped.push({ id, reason: 'error', detail: 'no screenshot matched this story' });
            return;
        }
        const ext = path.extname(story.screenshotPath).toLowerCase() || '.png';
        const image = `images/${String(index).padStart(4, '0')}${ext}`;
        fs.copyFileSync(story.screenshotPath, path.join(outDir, image));
        const file = path.relative(repoRoot, path.resolve(story.filepath)).split(path.sep).join('/');
        captures.push({
            id,
            image,
            kind: 'component',
            ...(title ? { title: title.split('/') } : {}),
            name: story.testName,
            code: {
                file,
                ...(story.location && story.location.startLine ? { line: story.location.startLine } : {}),
                ...(story.componentName ? { component: story.componentName } : {}),
            },
        });
    });

    const git = opts.gitContext || {};
    const manifest = {
        $schema: SCF_SCHEMA_URL,
        scf: '1.0',
        source: {
            kind: 'storybook',
            platform: 'web',
            framework: 'react',
            tool: { name: '@scrymore/scry-deployer analyze', version: opts.toolVersion },
        },
        ...(git.commitSha || git.branch || git.repository
            ? { repository: { ...(git.repository ? { url: git.repository } : {}), ...(git.commitSha ? { commit: git.commitSha } : {}), ...(git.branch ? { branch: git.branch } : {}) } }
            : {}),
        createdAt: new Date().toISOString(),
        defaults: { capture: { method: 'browser' } },
        counts: { declared: captures.length + skipped.length, captured: captures.length, skipped },
        captures,
    };
    fs.writeFileSync(path.join(outDir, 'scf.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { manifest, captured: captures.length, skipped: skipped.length };
}

module.exports = { writeAnalysisBundle };
