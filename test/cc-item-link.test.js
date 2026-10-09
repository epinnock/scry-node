/**
 * Creative Cloud item link (ISSUES #82 follow-on F17): cleanAdobeLink lets a ':' through only inside the one exact
 * `urn:aaid:sc:<REGION>:<uuid>` segment right after /files/libraries/ on www.adobe.com. The vectors are shared
 * verbatim by every cleaner (scry-sync, scry-node, processing, dashboard).
 */
const fs = require('fs');
const path = require('path');
const { cleanAdobeLink } = require('../lib/converter');

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'item-link-vectors.json'), 'utf8'));
const URN = 'urn:aaid:sc:US:b74cd75b-fa54-4eef-ae2d-acff941ac3bb';
const ITEM = 'ac7e59e9-98c8-4c63-b817-b6a7c5f27591';

describe('F17 item link vectors (shared)', () => {
    test.each(vectors.accept)('accepts %s unchanged', (link) => {
        expect(cleanAdobeLink(link)).toBe(link);
    });
    test.each(vectors.strip_to)('strips the query: %s', (raw, clean) => {
        expect(cleanAdobeLink(raw)).toBe(clean);
    });
    test.each(vectors.reject)('rejects %s', (link) => {
        expect(cleanAdobeLink(link)).toBeNull();
    });
});

describe('guarantee-f17b a colon gets through only inside the exact urn segment', () => {
    test('guarantee-f17b a colon anywhere else in the path is dropped', () => {
        const bad = [
            `https://www.adobe.com/files/libraries/${URN}/${ITEM}/x`,
            `https://www.adobe.com/files/libraries/${URN}/a:b`,
            `https://www.adobe.com/files/libraries/${URN}/${ITEM}:1`,
            `https://www.adobe.com/files/libraries/${URN}:`,
            `https://www.adobe.com/files/libraries/${URN}/urn:aaid:sc:US:${ITEM}`,
            `https://www.adobe.com/files/libraries/x/${URN}`,
            `https://www.adobe.com/files/${URN}`,
            `https://www.adobe.com/${URN}`,
            `https://www.adobe.com/files/libraries/urn:aaid:sc:US`,
            `https://www.adobe.com/files/libraries/urn:aaid:sc::${ITEM}`,
            `https://www.adobe.com/files/libraries/urn:aaid:sc:TOOLONGREGION:${ITEM}`,
            `https://www.adobe.com/files/libraries/urn:aaid:sc:U:${ITEM}`,
            `https://www.adobe.com/files/libraries/urn:aaid:xx:US:${ITEM}`,
            `https://assets.adobe.com/files/libraries/${URN}/${ITEM}`,
            `https://adobe.com/files/libraries/${URN}/${ITEM}`,
            'https://assets.adobe.com/libraries/a:b',
            'https://stock.adobe.com/91095766:1',
        ];
        expect(bad.filter((link) => cleanAdobeLink(link) !== null)).toEqual([]);
    });

    test('guarantee-f17b a query or fragment on an item link is stripped, never kept, and a canary in it is gone', () => {
        const link = cleanAdobeLink(`https://www.adobe.com/files/libraries/${URN}/${ITEM}?token=CANARY-77c1#x:y`);
        expect(link).toBe(`https://www.adobe.com/files/libraries/${URN}/${ITEM}`);
        expect(link).not.toMatch(/CANARY|token|\?|#/);
    });

    test('guarantee-f17b a secret word beside a valid urn still refuses the link', () => {
        expect(cleanAdobeLink(`https://www.adobe.com/files/libraries/${URN}/${ITEM}/token`)).toBeNull();
    });
});
