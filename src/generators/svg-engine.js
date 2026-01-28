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

// Letter @ 96 CSS px/in (LOCKED mapper + puppeteer contract)
const PAGE_W = 816;
const PAGE_H = 1056;

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
const templateDir = resolveTemplateDir(templatePath);
const assetsDir  = path.join(templateDir, "assets");
const mappingDir = path.join(templateDir, "mapping");
// Load ALL page maps (multi-page support)
const mapsByPage = {};

if (fs.existsSync(mappingDir)) {
  for (const file of fs.readdirSync(mappingDir)) {
    if (!file.endsWith(".map.json")) continue;

    const map = JSON.parse(
      fs.readFileSync(path.join(mappingDir, file), "utf8")
    );

    if (!map.pageId) continue;
    mapsByPage[map.pageId] = map;
  }
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
// after: const svg = await fs.promises.readFile(svgPath, "utf8");
let svg = await fs.promises.readFile(svgPath, "utf8");

// Ensure SVG preserves spaces inside <text> nodes
if (!/xml:space\s*=\s*["']preserve["']/.test(svg)) {
  svg = svg.replace(
    /<svg(\s[^>]*)?>/,
    (m) => m.replace("<svg", '<svg xml:space="preserve"')
  );
}
/**
 * Permanent EJS safety:
 * - EJS uses `with (locals) { ... }`
 * - `has: () => true` makes every identifier "exist" to avoid ReferenceError
 * - missing values return "" (blank)
 */
function safeLocals(obj = {}) {
  const base = obj && typeof obj === "object" ? obj : {};

  // EJS internal identifiers we must NOT shadow
  const RESERVED = new Set([
    "__append",
    "__output",
    "__line",
    "__lines",
    "__filename",
    "__dirname",
    "__locals",
    "include",
    "rethrow",
    "escapeFn",
  ]);

  return new Proxy(base, {
    has: (target, prop) => {
      if (typeof prop === "symbol") return prop in target;
      if (RESERVED.has(prop)) return false; // critical
      return true; // keep "missing vars become blank" behavior
    },
    get: (target, prop) => {
      if (typeof prop === "symbol") return target[prop];
      if (RESERVED.has(prop)) return undefined; // critical
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

function loadPagesFromAssetsDir(assetsDir) {
  try {
    if (!fs.existsSync(assetsDir)) return [];
    const files = fs
      .readdirSync(assetsDir)
      .filter((f) => /^page-\d+\.svg$/i.test(f))
      .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));

    return files.map((f) => fs.readFileSync(path.join(assetsDir, f), "utf8"));
  } catch (e) {
    console.error("[SVG Engine] Failed reading assets pages:", e);
    return [];
  }
}

async function assertPageContract(page) {
  await page.evaluate(
    ({ w, h }) => {
      const el = document.querySelector(".page");
      if (!el) throw new Error("[SVG Engine] Missing .page container in template");
      const r = el.getBoundingClientRect();
      if (Math.round(r.width) !== w || Math.round(r.height) !== h) {
        throw new Error(`[SVG Engine] .page must be ${w}x${h}, got ${r.width}x${r.height}`);
      }
    },
    { w: PAGE_W, h: PAGE_H }
  );
}

export async function generate(jobData) {
  const { requestRow = {}, assets = {}, templatePath = "" } = jobData || {};
  let browser = null;
  let page = null;

  try {
    const templateDir = resolveTemplateDir(templatePath);

    const templateFile = path.join(templateDir, "index.ejs");
    const sharedCssFile = path.join(templateDir, "..", "_shared", "styles.css");
    const bgFile = path.join(templateDir, "background.svg");
    const assetsDir = path.join(templateDir, "assets");

    if (!fs.existsSync(templateFile)) {
      throw new Error(`[SVG Engine] Missing template file: ${templateFile}`);
    }

    // Used only when SVG must be embedded as a data URI (HTML/img contexts)
    // NOT required for inline SVG rendering
    // RSS RULE: Styles are universal + live in HomeBase _shared only
    const styles = readIfExists(sharedCssFile);
    const backgroundSvg = readSvgAsDataUriIfExists(bgFile);

    const rawLocals = buildLocals({ requestRow, assets, backgroundSvg, styles });
    const locals = safeLocals(rawLocals);

    // Provide SVG pages[] to index.ejs (NO imports inside EJS)
    locals.templateName = path.basename(templateDir);
    locals.pages = loadPagesFromAssetsDir(assetsDir);

    // Render HTML (keep strict:false so Proxy.has() works with EJS `with()`)
    const html = await ejs.renderFile(templateFile, locals, {
      async: true,
      strict: false,
    });

    // PDF
    browser = await launchBrowser();
    page = await browser.newPage();

    // LOCK VIEWPORT to mapper coordinate space (Letter @ 96 CSS px/in)
    await page.setViewport({ width: PAGE_W, height: PAGE_H, deviceScaleFactor: 1 });

    // Load HTML
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluateHandle("document.fonts.ready");

    // Fail fast if any template breaks the coordinate contract
    await assertPageContract(page);

    const buffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      scale: 1,
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
