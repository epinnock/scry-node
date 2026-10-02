/**
 * A minimal uncompressed TIFF writer: the hand-off from the PSD/PSB reader to sharp. TIFF is used (not raw pixels)
 * because it carries both CMYK and the file's ICC profile, so the colour conversion to sRGB happens in Little CMS
 * with the profile Photoshop saved, exactly as for any other file.
 */
const TYPE = { SHORT: 3, LONG: 4, UNDEFINED: 7 };
const PHOTOMETRIC = { grey: 1, rgb: 2, cmyk: 5 };

/**
 * @param {{width:number, height:number, space:'grey'|'rgb'|'cmyk', pixels:Buffer, icc?:Buffer|null}} image
 *   interleaved 8-bit samples (CMYK: 0 = no ink, as TIFF stores it)
 * @returns {Buffer}
 */
function encodeValues(type, values) {
    if (type === TYPE.UNDEFINED) return Buffer.from(values);
    const unit = type === TYPE.SHORT ? 2 : 4;
    const data = Buffer.alloc(values.length * unit);
    values.forEach((v, j) => {
        if (unit === 2) data.writeUInt16LE(v, j * 2);
        else data.writeUInt32LE(v, j * 4);
    });
    return data;
}

function encodeTiff({ width, height, space, pixels, icc }) {
    const samples = { grey: 1, rgb: 3, cmyk: 4 }[space];
    if (pixels.length !== width * height * samples) throw new Error('pixel buffer does not match the image size');
    const entries = [
        [256, TYPE.LONG, [width]],
        [257, TYPE.LONG, [height]],
        [258, TYPE.SHORT, new Array(samples).fill(8)],
        [259, TYPE.SHORT, [1]],
        [262, TYPE.SHORT, [PHOTOMETRIC[space]]],
        [273, TYPE.LONG, [0]], // strip offset, patched below
        [277, TYPE.SHORT, [samples]],
        [278, TYPE.LONG, [height]],
        [279, TYPE.LONG, [pixels.length]],
        [284, TYPE.SHORT, [1]],
    ];
    if (space === 'cmyk') entries.push([332, TYPE.SHORT, [1]]);
    if (icc && icc.length > 0) entries.push([34675, TYPE.UNDEFINED, icc]);

    const ifdOffset = 8;
    const ifdSize = 2 + entries.length * 12 + 4;
    let extraOffset = ifdOffset + ifdSize;
    const extras = [];
    const ifd = Buffer.alloc(ifdSize);
    ifd.writeUInt16LE(entries.length, 0);
    let stripOffsetSlot = -1;
    entries.forEach(([tag, type, values], i) => {
        const at = 2 + i * 12;
        const data = encodeValues(type, values);
        ifd.writeUInt16LE(tag, at);
        ifd.writeUInt16LE(type, at + 2);
        ifd.writeUInt32LE(values.length, at + 4);
        if (data.length <= 4) {
            data.copy(ifd, at + 8);
            if (tag === 273) stripOffsetSlot = at + 8;
        } else {
            ifd.writeUInt32LE(extraOffset, at + 8);
            extras.push(data);
            extraOffset += data.length + (data.length % 2);
            if (data.length % 2) extras.push(Buffer.alloc(1));
        }
    });
    ifd.writeUInt32LE(0, ifdSize - 4);
    ifd.writeUInt32LE(extraOffset, stripOffsetSlot);
    const header = Buffer.from([0x49, 0x49, 42, 0, ifdOffset, 0, 0, 0]);
    return Buffer.concat([header, ifd, ...extras, pixels]);
}

module.exports = { encodeTiff };
