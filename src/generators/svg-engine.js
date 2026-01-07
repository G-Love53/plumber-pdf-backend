import puppeteer from "puppeteer-core";
import ejs from "ejs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sanitizeFilename = (str = "") =>
  String(str).replace(/[^a-z0-9]/gi, "_").substring(0, 50);

function resolveTemplateDir(templatePath = "") {
  // /app/src/generators -> project root is /app
  const projectRoot = path.join(__dirname, "..", "..");

  const tp = String(templatePath || "").replace(/\\/g, "/"); // normalize windows slashes

  // If caller already passes "templates/ACORD25" (or "Templates/ACORD25"), use it directly (but force lowercase folder name)
  if (tp.toLowerCase().startsWith("templates/")) {
    return path.join(projectRoot, "templates", tp.slice("templates/".length));
  }

  // If caller passes "/app/templates/ACORD25" style absolute, just use it
  if (tp.startsWith("/")) return tp;

  // Normal case: caller passes "ACORD25"
  return path.join(projectRoot, "templates", tp);
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
    const templateFile = path.join(__dirname, "../../", templatePath, "index.ejs");

// Always load template CSS if present (so templates can safely inject it)
const cssPath = path.join(__dirname, "../../", templatePath, "styles.css");
const styles = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";

const html = await ejs.renderFile(templateFile, {
  // Standard contract for ALL templates:
  data: requestRow,          // templates should read from data
  styles,                   // templates can safely inject <%- styles %>
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
