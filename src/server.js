import express from 'express';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const SERVICE_NAME = 'plumber-supp-pdf';
const SEGMENT = 'plumber';
const BRAND = 'PlumberInsuranceDirect';
const SITE_URL = 'https://www.plumberinsurancedirect.com';

const app = express();
app.use(express.json({ limit: '4mb' }));

// CORS lock-down to THIS SEGMENT ONLY
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/healthz', (_req, res) =>
  res.status(200).json({ ok: true, service: SERVICE_NAME, segment: SEGMENT })
);

// Main PDF Route
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

    // Brand the PDF filename (optional but recommended)
    const filename = `${SEGMENT}-contractor-supplemental.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Render failed', detail: String(err) });
  }
});

// Port binding for Render/Heroku
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`${SERVICE_NAME} listening on ${PORT}`));

