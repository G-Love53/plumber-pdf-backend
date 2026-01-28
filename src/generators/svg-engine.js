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
  if (!fs.existsSync(mappingDir)) return maps;

  for (const file of fs.readdirSync(mappingDir)) {
    if (!file.endsWith(".map.json")) continue;
    const map = JSON.parse(
      fs.readFileSync(path.join(mappingDir, file), "utf8")
    );
    if (map.pageId) maps[map.pageId] = map;
  }
  return maps;
}

function applyMapping(svg, pageMap, data) {
  if (!pageMap?.fields?.length) return svg;

  let out = svg;

  for (const f of pageMap.fields) {
    const val = data[f.name] ?? "";
    out = out.replace(
      new RegExp(
        `(<text[^>]*data-field="${f.name}"[^>]*>)([\\s\\S]*?)(</text>)`,
        "g"
      ),
      `$1${String(val)}$3`
    );
  }

  // Preserve spacing
  if (!/xml:space=/.test(out)) {
    out = out.replace("<svg", '<svg xml:space="preserve"');
  }

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
  const templateFile = path.join(templateDir, "index.ejs");

  if (!fs.existsSync(templateFile)) {
    throw new Error(`[SVG Engine] Missing index.ejs in ${templateDir}`);
  }

  // Load assets + maps
  const pages = loadSvgPages(assetsDir);
  const mapsByPage = loadMaps(mappingDir);

  // Apply mapping per page
  const finalPages = pages.map(p =>
    applyMapping(p.svg, mapsByPage[p.pageId], requestRow)
  );

  // Render HTML
  const html = await ejs.renderFile(
    templateFile,
    { pages: finalPages },
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
