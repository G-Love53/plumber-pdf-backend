import puppeteer from "puppeteer-core";
import ejs from "ejs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sanitizeFilename = (str = "") =>
  String(str).replace(/[^a-z0-9]/gi, "_").substring(0, 50);

/**
 * templatePath examples we support:
 * - "ACORD25"                  -> /app/templates/ACORD25
 * - "templates/ACORD25"        -> /app/templates/ACORD25
 * - "/app/templates/ACORD25"   -> /app/templates/ACORD25
 */
function resolveTemplateDir(templatePath = "") {
  const projectRoot = path.join(__dirname, "..", ".."); // -> /app
  const tp = String(templatePath || "").replace(/\\/g, "/").trim();

  if (!tp) return path.join(projectRoot, "templates");

  if (tp.startsWith("/")) return tp;

  if (tp.toLowerCase().startsWith("templates/")) {
    return path.join(projectRoot, "templates", tp.slice("templates/".length));
  }

  return path.join(projectRoot, "templates", tp);
}

export async function generate(jobData) {
  const { requestRow = {}, assets = {}, templatePath = "" } = jobData || {};
  let browser = null;

  try {
    const templateDir = resolveTemplateDir(templatePath);

    const templateFile = path.join(templateDir, "index.ejs");
    const cssFile = path.join(templateDir, "styles.css");
    const bgFile = path.join(templateDir, "background.svg");

    // Fail fast if template missing
    if (!fs.existsSync(templateFile)) {
      throw new Error(`[SVG Engine] Missing template file: ${templateFile}`);
    }

    // optional background.svg -> embed as base64 data URL
    let backgroundSvg = "";
    if (fs.existsSync(bgFile)) {
      backgroundSvg = `data:image/svg+xml;base64,${fs
        .readFileSync(bgFile)
        .toString("base64")}`;
    } else {
      console.warn(`[SVG Engine] Warning: Background SVG not found at ${bgFile}`);
    }

    // inline CSS (fixes: styles is not defined)
    const styles = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, "utf8") : "";

    // Render with a stable contract expected by ACORD25.ejs:
    // - data (object)
    // - styles (string)
    // - assets (object)
    const html = await ejs.renderFile(templateFile, {
      data: requestRow,
      styles,
      assets: { ...assets, background: backgroundSvg },
      formatDate: (d) => (d ? new Date(d).toLocaleDateString("en-US") : ""),
    });

    // Launch Puppeteer
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
        filename: `COI_${safeSegment}_${safeHolder}_${requestRow.id || "noid"}.pdf`,
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
