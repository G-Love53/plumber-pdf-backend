// src/pdf.js - PDF rendering with Puppeteer
import puppeteer from "puppeteer-core";
import ejs from "ejs";
import fs from "fs/promises";

/**
 * Render an EJS template to PDF
 * @param {Object} options
 * @param {string} options.htmlPath - Path to EJS template
 * @param {string} options.cssPath - Path to CSS file (optional)
 * @param {Object} options.data - Data to pass to template
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function renderPdf({ htmlPath, cssPath, data }) {
  // Render EJS to HTML
  const html = await ejs.renderFile(htmlPath, { data }, { async: true });

  // Optionally inject CSS
  let finalHtml = html;
  if (cssPath) {
    try {
      const css = await fs.readFile(cssPath, "utf8");
      finalHtml = html.replace("</head>", `<style>${css}</style></head>`);
    } catch (err) {
      // CSS file not found, continue without it
      console.warn(`CSS file not found: ${cssPath}`);
    }
  }

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();
  await page.setContent(finalHtml, { waitUntil: "networkidle0" });
  await page.emulateMediaType("screen");

  // Generate PDF
  const pdfBuffer = await page.pdf({
    format: "Letter",
    margin: {
      top: "0.5in",
      right: "0.5in",
      bottom: "0.5in",
      left: "0.5in",
    },
    printBackground: true,
  });

  await browser.close();

  return pdfBuffer;
}
