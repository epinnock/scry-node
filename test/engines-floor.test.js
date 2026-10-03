/**
 * The Node floor in package.json must be one every dependency accepts, and CI must not test below it.
 * sharp 0.35 needs Node >= 20.9; a lower floor would let npm install a package that cannot load.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function floor(range) {
    const m = /^>=\s*(\d+)(?:\.(\d+))?/.exec(range);
    if (!m) throw new Error(`unreadable engines range: ${range}`);
    return [Number(m[1]), Number(m[2] || 0)];
}
const atLeast = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);

describe('engines floor', () => {
    test('is at least what sharp requires', () => {
        const sharpPkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/sharp/package.json'), 'utf8'));
        expect(atLeast(floor(pkg.engines.node), floor(sharpPkg.engines.node))).toBe(true);
    });

    test('CI does not test a Node major below the floor', () => {
        const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
        const matrix = /node-version:\s*\[([^\]]+)\]/.exec(ci);
        expect(matrix).not.toBeNull();
        const majors = matrix[1].split(',').map((s) => Number(s.trim()));
        expect(Math.min(...majors)).toBeGreaterThanOrEqual(floor(pkg.engines.node)[0]);
    });
});
