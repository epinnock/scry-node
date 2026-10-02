/**
 * Child process for the PDF memory test: converts a generated many-page PDF and prints the peak RSS (MB) of THIS
 * process, which holds nothing but the converter (jest's own memory would drown the number).
 * Usage: node pdfPeakRss.js <pages> <workdir>
 */
const fs = require('fs');
const path = require('path');
const { convertFile } = require('../../lib/converter');
const fx = require('./syncFixtures.js');

(async () => {
    const [pages, dir] = [Number(process.argv[2]), process.argv[3]];
    const file = path.join(dir, 'many.pdf');
    fs.writeFileSync(file, fx.makePdf(Array.from({ length: pages }, () => ({ w: 595, h: 842 }))));
    const result = await convertFile(file, { tools: [] });
    process.stdout.write(JSON.stringify({ verdict: result.verdict, pictures: result.pictures.length, peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024) }));
})();
