// src/generators/svg-engine.js
import puppeteer from "puppeteer-core";
import ejs from "ejs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sanitizeFilename = (str = "") =>
  String(str || "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 80);

function resolveTemplateDir(templatePath = "") {
  const projectRoot = path.join(__dirname, "..", ".."); // repo root (/app on Render)
  const tp = String(templatePath || "").replace(/\\/g, "/").trim();

  if (!tp) return path.join(projectRoot, "templates");
  if (tp.startsWith("/")) return tp;

  if (tp.toLowerCase().startsWith("vendor/")) return path.join(projectRoot, tp);
  if (tp.toLowerCase().startsWith("templates/")) return path.join(projectRoot, tp);

  return path.join(projectRoot, "templates", tp);
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

function buildLocals({ requestRow = {}, assets = {}, backgroundSvg = "", styles = "" }) {
  // IMPORTANT CONTRACT (works for ALL templates going forward):
  // - Top-level locals: every requestRow key is available directly (holder_name, applicant_name, etc.)
  // - data: requestRow (so templates can use data.holder_name style too)
  // - formData: alias to requestRow (back-compat for older templates)
  // - assets: passed through + background
  // - styles: inline CSS
  return {
    ...requestRow, // <-- fixes "holder_name is not defined" everywhere
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
    throw new Error(
      "[SVG Engine] No Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH."
    );
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

export async function generate(jobData) {
  const { requestRow = {}, assets = {}, templatePath = "" } = jobData || {};
  let browser = null;

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

    const locals = buildLocals({ requestRow, assets, backgroundSvg, styles });

    // Render HTML
    const html = await ejs.renderFile(templateFile, locals, { async: true });

    // PDF
    browser = await launchBrowser();
    const page = await browser.newPage();

    // More reliable than domcontentloaded for SVG-heavy pages
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluateHandle("document.fonts.ready");

    const buffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    // Filename: if this is a COI request we keep COI naming; otherwise a generic safe name.
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
      if (browser) await browser.close();
    } catch (e) {
      console.error("[SVG Engine] Browser close error:", e);
    }
  }
}
