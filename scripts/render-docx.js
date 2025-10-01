const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const htmlDocx = require('html-docx-js');

async function main() {
  const inArg = process.argv[2];
  const outArg = process.argv[3];
  if (!inArg || !outArg) {
    console.error('Usage: node render-docx.js <input.html> <output.docx>');
    process.exit(1);
  }
  const htmlPath = path.resolve(inArg);
  const outPath = path.resolve(outArg);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html);
  // Optionally inline styles or sanitize here
  const document = dom.window.document;
  const content = '<!DOCTYPE html>' + document.documentElement.outerHTML;
  const docxBuffer = htmlDocx.asBlob(content);
  fs.writeFileSync(outPath, Buffer.from(await docxBuffer.arrayBuffer()));
  console.log('Wrote', outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });