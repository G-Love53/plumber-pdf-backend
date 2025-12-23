import fs from "fs/promises";
import path from "path";
import ejs from "ejs";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";

/* ---------- module path helpers ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- SVG Injector (The API-Ready Asset Loader) ---------- */
const loadSvg = async (filename) => {
  // Define search paths. Priority: Template assets -> Public assets
  const searchPaths = [
    path.join(__dirname, "../Templates/UniversalAccord25/assets"),
    path.join(__dirname, "../public/assets/forms"),
  ];

  let filePath = null;

  // 1. Find the SVG file
  for (const dir of searchPaths) {
    const testPath = path.join(dir, filename);
    try {
      await fs.access(testPath);
      filePath = testPath;
      break;
    } catch (e) {
      // Continue searching
    }
  }

  if (!filePath) {
    console.warn(`⚠️ SVG Asset not found: ${filename}`);
    return ""; // Returns empty string so PDF generates without crashing (just missing the bg)
  }

  // 2. Read and Convert to Base64 Data URI
  // This is critical for "API Speed" - no disk reading during the print process
  const fileBuffer = await fs.readFile(filePath);
  return `data:image/svg+xml;base64,${fileBuffer.toString('base64')}`;
};

/* ---------- Inline Helpers (Unchanged) ---------- */
const yn = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (v === true || ["y","yes","true","1","on","checked"].includes(s)) return "Y";
  if (v === false || ["n","no","false","0"].includes(s)) return "N";
  return "";
};
// ... (Your existing money, date, and formatting helpers remain here) ...
const money = (v) => {
  if (v === 0) return "0.00";
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const moneyUSD = (v) => { const s = money(v); return s ? `$${s}` : ""; };
const formatDate = (d = new Date()) => {
  const dt = d instanceof Date ? d : new Date(d);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${dt.getFullYear()}`;
};
const ck = (v) => (yn(v) === "Y" ? "X" : "");
const isYes = (v) => { const s = String(v ?? "").trim().toLowerCase(); return v === true || v === 1 || ["y","yes","true","1","on","checked"].includes(s); };
const yesno = (v) => (yn(v) === "Y" ? "Yes" : (yn(v) === "N" ? "No" : ""));
const isyes = (v) => isYes(v); 
const join = (parts, sep = ", ") => { const arr = Array.isArray(parts) ? parts : [parts]; return arr.filter(x => x != null && String(x).trim() !== "").join(sep); };


/* ---------- Main Renderer ---------- */
export async function renderPdf({ htmlPath, cssPath, data = {} }) {
  console.log("PDF Render - htmlPath:", htmlPath);
  
  // 1. Load Template & CSS
  const templateStr = await fs.readFile(htmlPath, "utf8");
  let cssStr = "";
  try {
    if (cssPath) cssStr = await fs.readFile(cssPath, "utf8");
  } catch (err) {
    console.error("Failed to load CSS:", err.message);
  }

  // 2. Render EJS to HTML
  let html;
  try {
    html = await ejs.render(
      templateStr,
      {
        ...data,
        data,
        formData: data,
        styles: cssStr,
        helpers: {
          // Pass your existing helpers
          yn, money, moneyUSD, formatDate, ck, isYes, join, yesno, isyes,
          // NEW: The SVG Loader Helper
          loadSvg: async (name) => await loadSvg(name) 
        },
        // Direct access for legacy calls
        yn, money, moneyUSD, formatDate, ck, isYes, join, yesno, isyes
      },
      {
        async: true, // REQUIRED for await loadSvg()
        filename: htmlPath,
        compileDebug: true
      }
    );
  } catch (err) {
    throw new Error(`EJS Compile Error: ${err.message}`);
  }
  
  // 3. Launch "The Robot" (Puppeteer)
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/app/chrome/chrome-linux64/chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none", "--disable-dev-shm-usage"]
  });
  
  try {
    const page = await browser.newPage();
    
    // 4. Load Content with Traffic Control
    // 'networkidle0' ensures the SVGs are fully painted before printing
    await page.setContent(html, { 
        waitUntil: ["load", "networkidle0"], 
        timeout: 60000 
    });

    // 5. Print
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true, // CRITICAL: This allows the SVG background to show
      preferCSSPageSize: false,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      scale: 1
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}
