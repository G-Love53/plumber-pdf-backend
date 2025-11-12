import express from 'express';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const app = express();
app.use(express.json({ limit: '4mb' }));

// Health check
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, service: 'contractor-supp-pdf' }));

// Render Contractor Supplemental to PDF
app.post('/pdf/contractor-supp', async (req, res) => {
  try {
    const data = req.body && Object.keys(req.body).length ? req.body : {};
    const tplPath = path.join(process.cwd(), 'templates', 'contractor-supp.ejs');
    const cssPath = path.join(process.cwd(), 'styles', 'print.css');

    const html = await ejs.renderFile(tplPath, { data }, { async: false });
    const css = fs.readFileSync(cssPath, 'utf8');
    const finalHTML = html.replace('</head>', `<style>${css}</style></head>`);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(finalHTML, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('screen');

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      printBackground: true
    });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=\"contractor-supplemental.pdf\"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Render failed', detail: String(err) });
  }
});

// Port binding for Render/Heroku
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`contractor-supp-pdf listening on ${PORT}`));
