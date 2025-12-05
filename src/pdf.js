// src/pdf.js
import fs from "fs/promises";
import path from "path";
import ejs from "ejs";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";

/* ---------- inline helpers made available to EJS ---------- */
const yn = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (v === true || ["y","yes","true","1","on","checked"].includes(s)) return "Y";
  if (v === false || ["n","no","false","0"].includes(s)) return "N";
  return "";
};
const money = (v) => {
  if (v === 0) return "0.00";
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const moneyUSD = (v) => {
  const s = money(v);
  return s ? `$${s}` : "";
};
const formatDate = (d = new Date()) => {
  const dt = d instanceof Date ? d : new Date(d);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${dt.getFullYear()}`;
};
const ck = (v) => (yn(v) === "Y" ? "X" : "");
const isYes = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return v === true || v === 1 || ["y","yes","true","1","on","checked"].includes(s);
};
const yesno = (v) => (yn(v) === "Y" ? "Yes" : (yn(v) === "N" ? "No" : ""));
const isyes = (v) => isYes(v); // alias to satisfy lowercase calls

const join = (parts, sep = ", ") => {
  const arr = Array.isArray(parts) ? parts : [parts];
  return arr.filter(x => x != null && String(x).trim() !== "").join(sep);
};

/* ---------- module path helpers ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- main renderer ---------- */
export async function renderPdf({ htmlPath, cssPath, data = {} }) {
  console.log("PDF Render - htmlPath:", htmlPath);
  console.log("PDF Render - cssPath:", cssPath);
  
  // Load template + CSS
  const templateStr = await fs.readFile(htmlPath, "utf8");
  
  let cssStr = "";
  try {
    if (cssPath) {
      cssStr = await fs.readFile(cssPath, "utf8");
      console.log("CSS loaded successfully:", cssStr.length, "characters");
    } else {
      console.log("No CSS path provided");
    }
  } catch (err) {
    console.error("Failed to load CSS:", err.message);
    cssStr = "";
  }
  
  // Render EJS -> HTML (expose helpers and styles)
  let html;
  try {
    html = await ejs.render(
      templateStr,
      {
        ...data,             // flattened access
        data,                // nested access
        formData: data,      // legacy alias
        styles: cssStr,      // used by <style><%= styles %></style>

        // Add helpers object for EJS templates that use helpers.functionName
        helpers: {
          yn, money, moneyUSD, formatDate, ck, isYes, join, yesno, isyes
        },
        
        // Also expose helpers directly for backwards compatibility
        yn, money, moneyUSD, formatDate, ck, isYes, join, yesno, isyes
      },
      {
        async: true,
        filename: htmlPath,   // lets EJS report filename
        compileDebug: true    // lets EJS report line numbers
      }
    );
  } catch (err) {
    const msg =
      `EJS compile error in ${htmlPath}: ${err.message}` +
      (err.lineNumber ? ` (line ${err.lineNumber})` : "");
    throw new Error(msg);
  }
  
  // Launch Chrome and generate PDF
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/app/chrome/chrome-linux64/chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none", "--disable-dev-shm-usage"]
  });
  
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: false,  // Let Puppeteer control size
      margin: { 
        top: '0.5in', 
        right: '0.5in', 
        bottom: '0.5in', 
        left: '0.5in' 
      },
      scale: 1
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}
