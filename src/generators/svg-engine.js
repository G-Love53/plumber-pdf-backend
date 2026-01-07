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
  // Project root: /app
  const projectRoot = path.join(__dirname, "..", "..");

  const tp = String(templatePath || "").replace(/\\/g, "/"); // normalize slashes

  // If already "templates/ACORD25" -> join to /app/templates/ACORD25
  if (tp.toLowerCase().startsWith("templates/")) {
    return path.join(projectRoot, "templates", tp.slice("templates/".length));
  }

  // If absolute path passed, use as-is
  if (tp.startsWith("/")) return tp;

  // Otherwise treat as folder name inside /app/templates
  return path.join(projectRoot, "templates", tp);
}

export async function generate(jobData) {
  const { requestRow, assets, templatePath } = jobData;
  let browser = null;

  try {
    const templateDir = resolveTemplateDir(templatePath);

    const templateFile = path.join(templateDir, "index.ejs");
    if (!fs.existsSync(templateFile)) {
      throw new Error(`[SVG Engine] Missing template file: ${templateFile}`);
    }

    // optional background.svg
    const bgPath = path.join(templateDir, "background.svg");
    let backgroundSvg = "";
    if (fs.existsSync(bgPath)) {
      backgroundSvg = `data:image/svg+xml;base64,${fs.readFileSync(bgPath).toString("base64")}`;
    } else {
      console.warn(`[SVG Engine] Warning: Background SVG not found at ${bgPath}`);
    }

    // inline template css (fixes: styles is not defined)
    const cssPath = path.join(templateDir, "styles.css");
    const styles = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";

    // Fixes: data.segment etc + keeps backward-compat by also spreading requestRow
    const viewModel = {
      data: requestRow,
      ...requestRow,
      styles,
      assets: {
        ...assets,
        background: backgroundSvg,
      },
      formatDate: (d) => (d ? new Date(d).toLocaleDateString() : ""),
    };


// Fail fast if template missing
if (!fs.existsSync(templateFile)) {
  throw new Error(`[SVG Engine] Missing template file: ${templateFile}`);
}

// Load CSS safely
let styles = "";
if (fs.existsSync(cssFile)) {
  styles = fs.readFileSync(cssFile, "utf8");
}

// Render with a stable contract
const html = await ejs.renderFile(templateFile, {
  data: requestRow,   // 👈 REQUIRED by ACORD25.ejs
  styles,             // 👈 REQUIRED by <%- styles %>
  assets: {
    ...assets,
    background: backgroundSvg
  },
  formatDate: (d) => (d ? new Date(d).toLocaleDateString() : "")
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
