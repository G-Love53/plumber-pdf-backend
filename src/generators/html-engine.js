import puppeteer from "puppeteer-core";
import ejs from "ejs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sanitizeFilename = (str = "") =>
  String(str).replace(/[^a-z0-9]/gi, "_").substring(0, 50);

export async function generate(jobData) {
  const { requestRow, assets, templatePath, globalCss } = jobData;
  let browser = null;

  try {
    const templateFile = path.join(__dirname, "../../", templatePath, "index.ejs");

    const html = await ejs.renderFile(templateFile, {
      data: requestRow,
      assets,
      globalCss
    });

    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });

    const buffer = await page.pdf({
      format: "Letter",
      printBackground: true
    });

    const safeSegment = sanitizeFilename(requestRow.segment || "default");
    const safeHolder = sanitizeFilename(requestRow.applicant_name || "Applicant");

    return {
      buffer,
      meta: {
        filename: `Supp_${safeSegment}_${safeHolder}_${requestRow.id}.pdf`,
        contentType: "application/pdf"
      }
    };
  } catch (err) {
    console.error("[HTML Engine Error]", err);
    throw err;
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {
      console.error("Browser close error:", e);
    }
  }
}
