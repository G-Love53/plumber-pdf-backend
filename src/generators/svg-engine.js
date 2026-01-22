// src/generators/svg-engine.js
import puppeteer from "puppeteer-core";
import ejs from "ejs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo root (/app on Render)
const PROJECT_ROOT = path.join(__dirname, "..", "..");

const sanitizeFilename = (str = "") =>
  String(str ?? "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 80);

function resolveTemplateDir(templatePath = "") {
  const tp = String(templatePath ?? "").replace(/\\/g, "/").trim();

  // Default templates dir (rarely used in your current architecture, but safe)
  if (!tp) return path.join(PROJECT_ROOT, "templates");

  // Absolute path (advanced use)
  if (tp.startsWith("/")) return tp;

  // Canonical paths (vendor/CID_HomeBase/... or templates/...)
  if (tp.toLowerCase().startsWith("vendor/")) return path.join(PROJECT_ROOT, tp);
  if (tp.toLowerCase().startsWith("templates/")) return path.join(PROJECT_ROOT, tp);

  // Otherwise treat as subfolder under /templates
  return path.join(PROJECT_ROOT, "templates", tp);
}

function readIfExists(p) {
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  } catch {}
  return "";
}

function readSvgAsDataUriIfExists(p) {
  try {
    if (!fs.existsSync(p)) return "";
    const raw = fs.readFileSync(p, "utf8");
    return `data:image/svg+xml;base64,${Buffer.from(raw, "utf8").toString("base64")}`;
  } catch {
    return "";
  }
}

/**
 * Permanent EJS safety:
 * - EJS uses `with (locals) { ... }`
 * - `has: () => true` makes every identifier "exist" to avoid ReferenceError
 * - missing values return "" (blank)
 */
function safeLocals(obj = {}) {
  const base = obj && typeof obj === "object" ? obj : {};
  return new Proxy(base, {
    has: () => true,
    get: (target, prop) => {
      if (typeof prop === "symbol") return target[prop];
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        const v = target[prop];
        return v === undefined || v === null ? "" : v;
      }
      return "";
    },
  });
}

function buildLocals({ requestRow = {}, assets = {}, backgroundSvg = "", styles = "" }) {
  // Contract:
  // - flat locals: holder_name, applicant_name, etc (legacy templates)
  // - data: requestRow (preferred style: data.holder_name)
  // - formData: alias to requestRow (older templates)
  // - assets/background/styles/helpers available to all templates
  return {
    ...requestRow,
    data: requestRow,
    formData: requestRow,
    styles,
    assets: { ...assets, background: backgroundSvg },
    helpers: {
      formatDate: (d) => (d ? new Date(d).toLocaleDateString("en-US") : ""),
      yn: (v) => {
        const s = String(v ?? "").toLowerCase();
        return s === "yes" || s === "y" || s === "true" || s === "1" ? "Yes" : "No";
      },
    },
  };
}

async function launchBrowser() {
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath?.();

  if (!executablePath) {
    throw new Error("[SVG Engine] No Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH.");
  }

  return puppeteer.launch({
    executablePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });
}

function assertValidPdfBuffer(buffer) {
  if (!buffer || buffer.length < 4) {
    throw new Error("[SVG Engine] PDF generation failed (empty/short buffer)");
  }
  const sig = buffer.subarray(0, 4).toString("utf8");
  if (sig !== "%PDF") {
    throw new Error("[SVG Engine] PDF generation failed (invalid PDF signature)");
  }
}

export async function generate(jobData) {
  const { requestRow = {}, assets = {}, templatePath = "" } = jobData || {};
  let browser = null;
  let page = null;

  try {
    const templateDir = resolveTemplateDir(templatePath);

    const templateFile = path.join(templateDir, "index.ejs");
    const cssFile = path.join(templateDir, "styles.css");
    const bgFile = path.join(templateDir, "background.svg");

    if (!fs.existsSync(templateFile)) {
      throw new Error(`[SVG Engine] Missing template file: ${templateFile}`);
    }

    const styles = readIfExists(cssFile);
    const backgroundSvg = readSvgAsDataUriIfExists(bgFile);

    const rawLocals = buildLocals({ requestRow, assets, backgroundSvg, styles });
    const locals = safeLocals(rawLocals);

    // Render HTML (keep strict:false so Proxy.has() works with EJS `with()`)
    const html = await ejs.renderFile(templateFile, locals, {
      async: true,
      strict: false,
    });

    // PDF
    browser = await launchBrowser();
    page = await browser.newPage();

    // Best for SVG-heavy pages; avoids hanging on networkidle0
    await page.setContent(html, { waitUntil: "load", timeout: 60000 });
    await page.evaluateHandle("document.fonts.ready");

    const buffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    assertValidPdfBuffer(buffer);

    const safeSegment = sanitizeFilename(requestRow.segment || "default");
    const safeHolder =
      sanitizeFilename(requestRow.holder_name) ||
      sanitizeFilename(requestRow.applicant_name) ||
      "Document";

    return {
      buffer,
      meta: {
        filename: `${safeSegment}_${safeHolder}_${requestRow.id || Date.now()}.pdf`,
        contentType: "application/pdf",
      },
    };
  } catch (err) {
    console.error("[SVG Engine Error]", err);
    throw err;
  } finally {
    try {
      if (page) await page.close();
    } catch {}
    try {
      if (browser) await browser.close();
    } catch (e) {
      console.error("[SVG Engine] Browser close error:", e);
    }
  }
}
