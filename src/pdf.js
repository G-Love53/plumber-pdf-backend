import fs from "fs/promises";
import path from "path";
import ejs from "ejs";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- SVG Pre-Loader ---------- */
const loadSvg = async (filename) => {
  const searchPaths = [
    path.join(__dirname, "../Templates/UniversalAccord25/assets"),
    path.join(__dirname, "../public/assets/forms"),
  ];

  for (const dir of searchPaths) {
    const testPath = path.join(dir, filename);
    try {
      await fs.access(testPath);
      const fileBuffer = await fs.readFile(testPath);
      // Return the full Data URI string
      return `data:image/svg+xml;base64,${fileBuffer.toString('base64')}`;
    } catch (e) {
      // Keep searching
    }
  }
  console.warn(`⚠️ Asset Missing: ${filename}`);
  return ""; // Return empty string if missing
};

/* ---------- Main Renderer ---------- */
export async function renderPdf({ htmlPath, cssPath, data = {} }) {
  console.log("PDF Render - Starting...");
  
  // 1. PRE-LOAD ASSETS
  // We only enable the files that currently exist in your assets folder.
  const assets = {
    // Logos
    logoPlumber: await loadSvg('logo-plumber.svg'),
    
    // Commented out until you upload them:
    // logoRoofer:  await loadSvg('logo-roofer.svg'), 
    // logoBar:     await loadSvg('logo-bar.svg'),
    // sigGeneric:  await loadSvg('sig-generic.svg'),

    // Forms
    'CG2010': await loadSvg('form-cg2010-0413.svg'),
    
    // Commented out until uploaded:
    // 'CG2037_1': await loadSvg('form-cg2037-0704_Page_1.svg'),
    // 'CG2037_2': await loadSvg('form-cg2037-0704_Page_2.svg'),
    // 'Waiver':   await loadSvg('form-cg2404-0509.svg'),
    // 'WC':       await loadSvg('form-wc000302.svg')
  };

  console.log("✅ Assets Pre-Loaded. Generating HTML...");

  // 2. Load Template & CSS
  const templateStr = await fs.readFile(htmlPath, "utf8");
  let cssStr = "";
  try {
    if (cssPath) cssStr = await fs.readFile(cssPath, "utf8");
  } catch (err) { console.error("CSS Load Error:", err.message); }

  // 3. Render EJS
  const html = await ejs.render(templateStr, {
    ...data,
    data,
    formData: data,
    styles: cssStr,
    assets: assets, // Passing the pre-loaded images
    helpers: {
      formatDate: (d) => new Date(d).toLocaleDateString('en-US'),
    }
  }, { async: true });

  // 4. Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/app/chrome/chrome-linux64/chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });
  
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: ["load", "networkidle0"], timeout: 60000 });
    
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true, 
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' }
    });
    
    console.log(`📄 PDF Generated Successfully! Size: ${pdfBuffer.length} bytes`);
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}
