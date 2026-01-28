import puppeteer from "puppeteer-core";
import ejs from "ejs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render root (/app on Render)
const PROJECT_ROOT = path.join(__dirname, "..", "..");

// Letter @ 96dpi (LOCKED)
const PAGE_W = 816;
const PAGE_H = 1056;

/* ---------------------------- PATH RESOLUTION ---------------------------- */

function resolveTemplateDir(templatePath = "") {
  const tp = String(templatePath ?? "").replace(/\\/g, "/").trim();

  if (!tp) throw new Error("[SVG Engine] templatePath is required");

  if (tp.startsWith("/")) return tp;
  if (tp.toLowerCase().startsWith("vendor/"))
    return path.join(PROJECT_ROOT, tp);
  if (tp.toLowerCase().startsWith("templates/"))
    return path.join(PROJECT_ROOT, tp);

  return path.join(PROJECT_ROOT, "templates", tp);
}

/* ---------------------------- SVG + MAPPING ---------------------------- */

function loadSvgPages(assetsDir) {
  if (!fs.existsSync(assetsDir)) return [];

  return fs
    .readdirSync(assetsDir)
    .filter(f => /^page-\d+\.svg$/i.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/\d+/)[0]);
      const nb = Number(b.match(/\d+/)[0]);
      return na - nb;
    })
    .map(f => ({
      pageId: f.replace(".svg", ""),
      svg: fs.readFileSync(path.join(assetsDir, f), "utf8"),
    }));
}

function loadMaps(mappingDir) {
  const maps = {};
  if (!fs.existsSync(mappingDir)) {
    throw new Error(`[SVG] mappingDir does not exist: ${mappingDir}`);
  }

  const files = fs.readdirSync(mappingDir);

  if (!files.length) {
    throw new Error(`[SVG] mappingDir empty: ${mappingDir}`);
  }

  for (const file of files) {
    if (!file.endsWith(".map.json")) continue;

    const full = path.join(mappingDir, file);
    const raw = fs.readFileSync(full, "utf8");

    if (!raw || !raw.trim()) {
      throw new Error(`[SVG] EMPTY MAP FILE: ${full}`);
    }

    let map;
    try {
      map = JSON.parse(raw);
    } catch (e) {
      throw new Error(`[SVG] BAD JSON: ${full} :: ${e.message}`);
    }

    if (!map.pageId) {
      throw new Error(`[SVG] map missing pageId: ${full}`);
    }

    maps[map.pageId] = map;
  }

  if (!Object.keys(maps).length) {
    throw new Error(`[SVG] No valid page maps loaded from ${mappingDir}`);
  }

  return maps;
}

function escapeXml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ensureXmlSpace(svg) {
  if (/xml:space\s*=\s*["']preserve["']/.test(svg)) return svg;
  return svg.replace(/<svg\b/, '<svg xml:space="preserve"');
}



// Coordinate overlay mapping (matches your mapper output)
function applyMapping(svg, pageMap, data) {
  if (!pageMap?.fields?.length) return ensureXmlSpace(svg);

  const overlay = [];
  overlay.push(`<g id="cid-overlay" font-family="Arial, Helvetica, sans-serif" fill="#000">`);

  for (const f of pageMap.fields) {
    const raw = data?.[f.name];
    const val = raw === undefined || raw === null ? "" : String(raw);
    if (!val) continue;

    const x = Number(f.x ?? 0);
    const y = Number(f.y ?? 0);
    const fontSize = Number(f.fontSize ?? 9);
    const baseline = f.baseline === "hanging" ? "hanging" : "alphabetic";

    overlay.push(
      `<text x="${x}" y="${y}" font-size="${fontSize}" dominant-baseline="${baseline}">${escapeXml(val)}</text>`
    );
  }

  overlay.push(`</g>`);
  const overlayBlock = overlay.join("");

  const out = svg.replace(/<\/svg>\s*$/i, `${overlayBlock}</svg>`);
  return ensureXmlSpace(out);
}

/* ---------------------------- BROWSER ---------------------------- */

async function launchBrowser() {
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    puppeteer.executablePath?.();

  if (!executablePath) {
    throw new Error("[SVG Engine] Chrome not found");
  }

  return puppeteer.launch({
    executablePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });
}

/* ---------------------------- MAIN ENTRY ---------------------------- */

export async function generate(jobData) {
  const { requestRow = {}, templatePath } = jobData;

  if (!templatePath) {
    throw new Error("[SVG Engine] Missing templatePath");
  }

  const templateDir = resolveTemplateDir(templatePath);
  const assetsDir = path.join(templateDir, "assets");
  const mappingDir = path.join(templateDir, "mapping");
  const templateFile = path.join(templateDir, "index.ejs");

  if (!fs.existsSync(templateFile)) {
    throw new Error(`[SVG Engine] Missing index.ejs in ${templateDir}`);
  }

  // Load assets + maps
  const pages = loadSvgPages(assetsDir);
  const mapsByPage = loadMaps(mappingDir);
  
  console.log("[SVG] Pages:", pages.map(p => p.pageId));
  console.log("[SVG] Maps:", Object.keys(mapsByPage));
  
  // Apply mapping per page
  const finalPages = pages.map(p =>
    applyMapping(p.svg, mapsByPage[p.pageId], requestRow)
  );

  // Render HTML
  const html = await ejs.renderFile(
  templateFile,
  {
    pages: finalPages,
    templateName: jobData?.templateName || jobData?.name || path.basename(templateDir),
    data: requestRow,
    formData: requestRow,
  },
  { async: true, strict: false }
);

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: PAGE_W,
      height: PAGE_H,
      deviceScaleFactor: 1,
    });

    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluateHandle("document.fonts.ready");

    const buffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    if (buffer.subarray(0, 4).toString() !== "%PDF") {
      throw new Error("[SVG Engine] Invalid PDF output");
    }

    return {
      buffer,
      meta: {
        contentType: "application/pdf",
        filename: `document_${Date.now()}.pdf`,
      },
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
