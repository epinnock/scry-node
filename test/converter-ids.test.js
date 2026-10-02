const crypto = require('crypto');
const { pictureId, normaliseRelativePath, PictureIdError } = require('../lib/converter');

const FOLDER = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('pictureId (Scry Sync, path-based ids)', () => {
    test('is sha256(folderUuid + normalised relative path), lower-case hex', () => {
        const expected = crypto.createHash('sha256').update(`${FOLDER}Screens/Home.psd`).digest('hex');
        expect(pictureId(FOLDER, 'Screens/Home.psd')).toBe(expected);
        expect(pictureId(FOLDER, 'Screens/Home.psd')).toMatch(/^[0-9a-f]{64}$/);
    });

    test('Windows and Mac paths of the same file give the same id (separators and Unicode NFC)', () => {
        const nfc = 'Écrans/Café.psd'.normalize('NFC');
        const nfd = 'Écrans/Café.psd'.normalize('NFD'); // what macOS hands out
        expect(nfc).not.toBe(nfd);
        const windows = pictureId(FOLDER, nfc.replace('/', '\\'));
        const mac = pictureId(FOLDER, nfd);
        expect(windows).toBe(mac);
        expect(pictureId(FOLDER, '.\\Écrans\\\\Café.psd')).toBe(mac);
        expect(pictureId(FOLDER.toUpperCase(), nfd)).toBe(mac);
    });

    test('case is preserved: Home.psd and home.psd are two ids', () => {
        expect(pictureId(FOLDER, 'Home.psd')).not.toBe(pictureId(FOLDER, 'home.psd'));
    });

    test('pages get #p<N> on the same hash', () => {
        const base = pictureId(FOLDER, 'Deck.pdf');
        expect(pictureId(FOLDER, 'Deck.pdf', 1)).toBe(`${base}#p1`);
        expect(pictureId(FOLDER, 'Deck.pdf', 12)).toBe(`${base}#p12`);
    });

    test('another folder gives another id for the same relative path', () => {
        expect(pictureId(FOLDER, 'a.png')).not.toBe(pictureId('00000000-0000-4000-8000-000000000000', 'a.png'));
    });

    test('refuses absolute, escaping and empty paths, bad uuids and bad pages', () => {
        expect(() => pictureId(FOLDER, '../a.png')).toThrow(PictureIdError);
        expect(() => pictureId(FOLDER, 'C:\\Users\\ann\\a.png')).toThrow(PictureIdError);
        expect(() => pictureId(FOLDER, '')).toThrow(PictureIdError);
        expect(() => pictureId('not-a-uuid', 'a.png')).toThrow(PictureIdError);
        expect(() => pictureId(FOLDER, 'a.pdf', 0)).toThrow(PictureIdError);
        expect(() => pictureId(FOLDER, 'a.pdf', 1.5)).toThrow(PictureIdError);
    });

    test('normaliseRelativePath', () => {
        expect(normaliseRelativePath('/a//b/./c.png')).toBe('a/b/c.png');
        expect(normaliseRelativePath('a\\B\\c.PNG')).toBe('a/B/c.PNG');
    });
});
