// src/generators/svg-engine.js
const puppeteer = require("puppeteer");
const ejs = require("ejs");
const path = require("path");

// Bulletproof filename sanitizer
const sanitizeFilename = (str = "") =>
  String(str).replace(/[^a-z0-9]/gi, "_").substring(0, 50);

async function generate(jobData) {
  const { requestRow, assets, templatePath } = jobData;
  let browser = null;

  try {
    const templateFile = path.join(__dirname, "../../", templatePath, "index.ejs");

    // Render HTML. We spread requestRow so existing EJS like <%= holder_name %> still works.
    const html = await ejs.renderFile(templateFile, {
      ...requestRow,
      assets: assets,
      formatDate: (d) => (d ? new Date(d).toLocaleDateString() : ""),
    });

    browser = await puppeteer.launch({
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });

    const buffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    const safeSeg = sanitizeFilename(requestRow.segment || "default");
    const safeHolder = sanitizeFilename(requestRow.holder_name || "Holder");

    return {
      buffer,
      meta: {
        filename: `COI_${safeSeg}_${safeHolder}_${requestRow.id}.pdf`,
        contentType: "application/pdf",
      },
    };
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {
      console.error("Browser close error:", e);
    }
  }
}

module.exports = { generate };

