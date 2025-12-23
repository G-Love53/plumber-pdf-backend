import fs from "fs/promises";
import path from "path";
import ejs from "ejs";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- Improved SVG Loader (Inline vs Data URI) ---------- */
const loadSvg = async (filename, { asDataUri = false } = {}) => {
  const searchPaths = [
    path.join(__dirname, "../Templates/UniversalAccord25/assets"),
    path.join(__dirname, "../public/assets/forms"),
  ];

  for (const dir of searchPaths) {
    const testPath = path.join(dir, filename);
    try {
      await fs.access(testPath);
      const svgText = await fs.readFile(testPath, "utf8");

      if (!asDataUri) {
        // Return Raw SVG Code (Cleaner for Forms)
        // Removes XML headers so it fits inside HTML without breaking it
        return svgText
          .replace(/<\?xml[\s\S]*?\?>/g, "")
          .replace(/<!DOCTYPE[\s\S]*?>/g, "")
          .trim();
      }

      // Return Base64 Data URI (Better for Logos/Images)
      const b64 = Buffer.from(svgText, "utf8").toString("base64");
      return `data:image/svg+xml;base64,${b64}`;
    } catch (e) {
      // Continue searching
    }
  }

  console.warn(`⚠️ Asset Missing: ${filename}`);
  return ""; 
};

/* ---------- Main Renderer ---------- */
export async function renderPdf({ htmlPath, cssPath, data = {} }) {
  console.log("PDF Render - Starting...");
  
  // 1. PRE-LOAD ASSETS
  const assets = {
    // LOGOS: Keep as Data URI (Images)
    logoPlumber: await loadSvg('logo-plumber.svg', { asDataUri: true }),
    
    // Commented out until you upload them:
    // logoRoofer:  await loadSvg('logo-roofer.svg', { asDataUri: true }), 
    // logoBar:     await loadSvg('logo-bar.svg', { asDataUri: true }),
    // sigGeneric:  await loadSvg('sig-generic.svg', { asDataUri: true }),

    // FORMS: Load as INLINE SVG (Raw Code)
    'CG2010': await loadSvg('form-cg2010-0413.svg', { asDataUri: false }),
    
    // Commented out until uploaded:
    // 'CG2037_1': await loadSvg('form-cg2037-0704_Page_1.svg', { asDataUri: false }),
    // 'CG2037_2': await loadSvg('form-cg2037-0704_Page_2.svg', { asDataUri: false }),
    // 'Waiver':   await loadSvg('form-cg2404-0509.svg', { asDataUri: false }),
    // 'WC':       await loadSvg('form-wc000302.svg', { asDataUri: false })
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
    assets: assets, // Passing the pre-loaded content
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
    
    // Wait for DOM + Fonts
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluateHandle("document.fonts.ready");
    
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true, 
      // ZERO MARGINS (Crucial for full-page SVG forms)
      margin: { top: "0in", right: "0in", bottom: "0in", left: "0in" }
    });
    
    console.log(`📄 PDF Generated Successfully! Size: ${pdfBuffer.length} bytes`);
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}
