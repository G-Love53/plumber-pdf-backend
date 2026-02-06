import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render root (/app on Render)
const PROJECT_ROOT = path.join(__dirname, "..", "..");

// Letter (LOCKED) — 612×792 truth (points, matches mapper + SVG viewBox)
const PAGE_W = 612;
const PAGE_H = 792;

const TEXT_PAD_Y = 2;   // pixels in your 612x792 space


/* ---------------------------- PATH RESOLUTION ---------------------------- */

function resolveTemplateDir(templatePath = "") {
  const tp = String(templatePath ?? "").replace(/\\/g, "/").trim();
  if (!tp) throw new Error("[SVG Engine] templatePath is required");

  // absolute path
  if (tp.startsWith("/")) return tp;

  // already a repo-relative path we support
  if (tp.startsWith("CID_HomeBase/")) return path.join(PROJECT_ROOT, tp);
  if (tp.startsWith("templates/")) return path.join(PROJECT_ROOT, tp);

  // convenience: if caller passes "ACORD125" or "SUPP_XYZ"
  // assume it's a local segment template under /templates
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

  // ✅ Mapping is OPTIONAL: allow blank PDFs before mapper work starts
  if (!fs.existsSync(mappingDir)) {
    console.log(`[SVG] mappingDir missing (ok): ${mappingDir}`);
    return maps;
  }

  const files = fs.readdirSync(mappingDir);

  // ✅ Empty mapping folder is OK
  if (!files.length) {
    console.log(`[SVG] mappingDir empty (ok): ${mappingDir}`);
    return maps;
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

  console.log(`[SVG] Loaded ${Object.keys(maps).length} map(s) from ${mappingDir}`);
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

function asString(v) {
  return v === undefined || v === null ? "" : String(v);
}

function isChecked(v) {
  if (v === true) return true;
  if (v === false || v === undefined || v === null) return false;

  const s = String(v).trim().toLowerCase();
  return s === "x" || s === "true" || s === "yes" || s === "y" || s === "1" || s === "on" || s === "checked";
}


// Coordinate overlay mapping (matches your mapper output)
function applyMapping(svg, pageMap, data) {
  if (!pageMap?.fields?.length) return ensureXmlSpace(svg);

  const overlay = [];
  overlay.push(`<g id="cid-overlay" font-family="Arial, Helvetica, sans-serif" fill="#000">`);

  for (const f of pageMap.fields) {
  const key = f.key || f.name;
  const raw = data?.[key];
  if (!key) continue;

  if (f.type === "checkbox") {
  if (isChecked(raw)) {
    const x = Number(f.x);
    const y = Number(f.y);
    const size = Number(f.size || f.fontSize || 10);

    // guard: bad map data should never crash rendering
    if (Number.isFinite(x) && Number.isFinite(y)) {
      overlay.push(
        `<text x="${x}" y="${y}" font-size="${size}" dominant-baseline="hanging">X</text>`
      );
    }
  }
  continue;
}

    const val = asString(raw);
  if (!val) continue;


  const x = Number(f.x);
  const y = Number(f.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

  overlay.push(
  `<text x="${x}" y="${y + TEXT_PAD_Y}" font-size="${Number(f.fontSize || 8)}"
    dominant-baseline="hanging" text-anchor="start">${escapeXml(val)}</text>`
);


}


  overlay.push(`</g>`);
  const overlayBlock = overlay.join("");

  const debugGrid = data?.__grid === true ? gridOverlay() : "";
  const out = svg.replace(/<\/svg>\s*$/i, `${overlayBlock}${debugGrid}</svg>`);

  return out;
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


  // Load assets + maps
  
  const pages = loadSvgPages(assetsDir);
  const mapsByPage = loadMaps(mappingDir);
  
  console.log("[SVG] Pages:", pages.map(p => p.pageId));
  console.log("[SVG] Maps:", Object.keys(mapsByPage));
  
  // Apply mapping per page
  const finalPages = pages.map(p =>
  applyMapping(p.svg, mapsByPage[p.pageId], requestRow)
);


const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${PAGE_W}pt ${PAGE_H}pt; margin: 0; }
    html, body { margin: 0; padding: 0; }
    .page { width: ${PAGE_W}pt; height: ${PAGE_H}pt; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    svg { width: ${PAGE_W}pt; height: ${PAGE_H}pt; display: block; }
  </style>
</head>
<body>
  ${finalPages.map(svg => `<div class="page">${svg}</div>`).join("")}
</body>
</html>
`;

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
  width: "8.5in",
  height: "11in",
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  scale: 1,
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
 // --- DEBUG ONLY: grid overlay (do not call in production unless debugging alignment) ---
function gridOverlay() {
  const lines = [];

  // Vertical grid lines
  for (let x = 0; x <= PAGE_W; x += 25) {
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${PAGE_H}" stroke="#00f" stroke-opacity="0.15" />`
    );
    if (x % 50 === 0) {
      lines.push(`<text x="${x + 2}" y="10" font-size="6">${x}</text>`);
    }
  }

  // Horizontal grid lines
  for (let y = 0; y <= PAGE_H; y += 25) {
    lines.push(
      `<line x1="0" y1="${y}" x2="${PAGE_W}" y2="${y}" stroke="#00f" stroke-opacity="0.15" />`
    );
    if (y % 50 === 0) {
      lines.push(`<text x="2" y="${y - 2}" font-size="6">${y}</text>`);
    }
  }

  return `<g id="grid-overlay">${lines.join("")}</g>`;
}

