const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function main() {
  const htmlPath = path.resolve(__dirname, '..', 'docs', 'refly_report.html');
  const outPath = path.resolve(__dirname, '..', 'docs', 'refly_report.pdf');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: outPath, format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '12mm', right: '12mm' } });
  await browser.close();
  console.log('Wrote', outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });

