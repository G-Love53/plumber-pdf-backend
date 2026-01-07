import puppeteer from "puppeteer-core";
import ejs from "ejs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sanitizeFilename = (str = "") =>
  String(str).replace(/[^a-z0-9]/gi, "_").substring(0, 50);

// IMPORTANT:
// templatePath should be the folder name like "ACORD25" (not a full path).
// This engine always resolves it under /Templates/<templatePath>/
function resolveTemplateDir(templatePath = "") {
  // From /src/generators -> project root is ../../
  // Then Templates/<templatePath>
  return path.join(__dirname, "..", "..", "Templates", templatePath);
}

export async function generate(jobData) {
  const { requestRow, assets, templatePath } = jobData;
  let browser = null;

  try {
    const templateDir = resolveTemplateDir(templatePath);

    // --- Background SVG (optional) ---
    const bgPath = path.join(templateDir, "background.svg");
    let backgroundSvg = "";

    if (fs.existsSync(bgPath)) {
      backgroundSvg = `data:image/svg+xml;base64,${fs
        .readFileSync(bgPath)
        .toString("base64")}`;
    } else {
      console.warn(`[SVG Engine] Warning: Background SVG not found at ${bgPath}`);
    }

    // --- EJS template (required) ---
    const templateFile = path.join(templateDir, "index.ejs");

    if (!fs.existsSync(templateFile)) {
      throw new Error(`[SVG Engine] Missing template file: ${templateFile}`);
    }

    const html = await ejs.renderFile(templateFile, {
      ...requestRow,
      assets: {
        ...assets,
        background: backgroundSvg,
      },
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

    const safeSegment = sanitizeFilename(requestRow.segment || "default");
    const safeHolder = sanitizeFilename(requestRow.holder_name || "Holder");

    return {
      buffer,
      meta: {
        filename: `COI_${safeSegment}_${safeHolder}_${requestRow.id}.pdf`,
        contentType: "application/pdf",
      },
    };
  } catch (err) {
    console.error("[SVG Engine Error]", err);
    throw err;
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {
      console.error("Browser close error:", e);
    }
  }
}
