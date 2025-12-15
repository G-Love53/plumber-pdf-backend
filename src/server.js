import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { renderPdf } from "./pdf.js";
import { sendWithGmail } from "./email.js";
// Note: Ensure your enricher import matches the file name in your 'src' folder
// For Roofer/Bar, you might need to comment this out or rename the enricher file to 'data-enricher.js' to make it standard.
// import enrichFormData from '../mapping/data-enricher.js'; 

// --- LEG 2 / LEG 3 IMPORTS ---
import { processInbox } from "./quote-processor.js";
import { triggerCarrierBind } from "./bind-processor.js";
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
   🟢 SECTION 1: CONFIGURATION (EDIT THIS PER SEGMENT)
   ============================================================ */

// 1. Map Frontend Names (from Netlify) to Actual Folder Names (in /Templates)
const TEMPLATE_ALIASES = {
  // Generic Name      : Actual Folder Name
  "Accord125":         "PlumberAccord125", // <--- CHANGE THIS for Plumber/Bar
  "Accord126":         "PlumberAccord126", // <--- CHANGE THIS
  "Accord140":         "PlumberAccord140", // <--- CHANGE THIS
  "WCForm":            "WCPlumberForm",       // <--- CHANGE THIS
  "Supplemental":      "PlumberSupp",      // <--- CHANGE THIS
  
  // Self-referencing aliases for safety (so code finds them even if full name is sent)
  "PlumberAccord125":  "PlumberAccord125",
  "PlumberAccord126":  "PlumberAccord126",
  "PlumberAccord140":  "PlumberAccord140",
};

// 2. Map Folder Names to Pretty Output Filenames (for the client email)
const FILENAME_MAP = {
  "PlumberAccord125": "ACORD-125.pdf",
  "PlumberAccord126": "ACORD-126.pdf",
  "PlumberAccord140": "ACORD-140.pdf",
  "PlumberSupp":      "Supplemental-Application.pdf",
  "WCPlumberForm":       "WC-Application.pdf"
};

/* ============================================================
   🔴 SECTION 2: LOGIC (DO NOT EDIT BELOW THIS LINE)
   ============================================================ */

const resolveTemplate = (name) => TEMPLATE_ALIASES[name] || name;

// --- APP SETUP ---
const APP = express();
APP.use(express.json({ limit: "20mb" }));

// CORS
APP.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const TPL_DIR = path.join(__dirname, "..", "Templates");
const MAP_DIR = path.join(__dirname, "..", "mapping");

// --- ROUTES ---

APP.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Helper: Data Mapping
async function maybeMapData(templateName, rawData) {
  try {
    const mapPath = path.join(MAP_DIR, `${templateName}.json`);
    const mapping = JSON.parse(await fs.readFile(mapPath, "utf8"));
    const mapped = {};
    for (const [tplKey, formKey] of Object.entries(mapping)) {
      mapped[tplKey] = rawData?.[formKey] ?? "";
    }
    return { ...rawData, ...mapped };
  } catch {
    return rawData;
  }
}

// Helper: Render Bundle
async function renderBundleAndRespond({ templates, email }, res) {
  if (!Array.isArray(templates) || templates.length === 0) {
    return res.status(400).json({ ok: false, error: "NO_TEMPLATES" });
  }

  const results = [];

  for (const t of templates) {
    const name = resolveTemplate(t.name);
    
    // Safety check: verify folder exists
    try {
        await fs.access(path.join(TPL_DIR, name));
    } catch (e) {
        console.error(`❌ Template folder not found: ${name} (Original: ${t.name})`);
        results.push({ status: "rejected", reason: `Template ${name} not found` });
        continue;
    }

    const htmlPath = path.join(TPL_DIR, name, "index.ejs");
    const cssPath  = path.join(TPL_DIR, name, "styles.css");
    const rawData  = t.data || {};
    const unified  = await maybeMapData(name, rawData);

    try {
      const buffer = await renderPdf({ htmlPath, cssPath, data: unified });
      const prettyName = FILENAME_MAP[name] || t.filename || `${name}.pdf`;
      results.push({ status: "fulfilled", value: { filename: prettyName, buffer } });
    } catch (err) {
      console.error(`❌ Render Error for ${name}:`, err.message);
      results.push({ status: "rejected", reason: err });
    }
  }

  const attachments = results.filter(r => r.status === "fulfilled").map(r => r.value);

  if (email?.to?.length) {
    await sendWithGmail({
      to: email.to,
      subject: email.subject || "Submission Packet",
      formData: email.formData,
      html: email.bodyHtml,
      attachments
    });
    return res.json({ ok: true, success: true, sent: true, count: attachments.length });
  }

  if (attachments.length > 0) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${attachments[0].filename}"`);
      res.send(attachments[0].buffer);
  } else {
      res.status(500).send("No valid PDFs were generated.");
  }
}

// 1. Render Bundle Endpoint
APP.post("/render-bundle", async (req, res) => {
  try {
    await renderBundleAndRespond(req.body || {}, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 2. Submit Quote Endpoint
APP.post("/submit-quote", async (req, res) => {
  try {
    let { formData = {}, segments = [], email } = req.body || {};
    // Optional: Run Enricher if you imported it
    // formData = enrichFormData(formData);

    const templates = (segments || []).map((name) => ({
      name, 
      filename: FILENAME_MAP[resolveTemplate(name)] || `${name}.pdf`,
      data: formData,
    }));
    
    if (templates.length === 0) {
      return res.status(400).json({ ok: false, success: false, error: "NO_VALID_SEGMENTS" });
    }

    const defaultTo = process.env.CARRIER_EMAIL || process.env.GMAIL_USER;
    const emailBlock = email?.to?.length
      ? email
      : {
          to: [defaultTo].filter(Boolean),
          subject: `New Submission — ${formData.applicant_name || ""}`,
          formData: formData,
        };

    await renderBundleAndRespond({ templates, email: emailBlock }, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, success: false, error: e.message });
  }
});

// 3. LEG 2: Check Quotes
APP.post("/check-quotes", async (req, res) => {
  console.log("🤖 Robot Waking Up: Checking for new quotes...");
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || "";
  const serviceEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const impersonatedUser = (process.env.GMAIL_USER || "").trim();
  const privateKey = rawKey.replace(/\\n/g, '\n');

  if (!serviceEmail || !impersonatedUser || !rawKey || !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing Env Vars" });
  }

  try {
    const jwtClient = new google.auth.JWT(
      serviceEmail, null, privateKey,
      ['https://www.googleapis.com/auth/gmail.modify'], impersonatedUser 
    );
    await jwtClient.authorize();
    const result = await processInbox(jwtClient); 
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Robot Error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// 4. LEG 3: Bind Quote
APP.get("/bind-quote", async (req, res) => {
    const quoteId = req.query.id;
    if (!quoteId) return res.status(400).send("Quote ID is missing.");
    try {
        await triggerCarrierBind({ quoteId }); 
        const confirmationHtml = `
            <!DOCTYPE html>
            <html><head><title>Bind Request Received</title></head>
            <body style="text-align:center; padding:50px; font-family:sans-serif;">
                <h1 style="color:#10b981;">Bind Request Received</h1>
                <p>We are processing your request for Quote ID: <b>${quoteId.substring(0,8)}</b>.</p>
            </body></html>`;
        res.status(200).send(confirmationHtml);
    } catch (e) {
        res.status(500).send("Error processing bind request.");
    }
});

const PORT = process.env.PORT || 8080;
APP.listen(PORT, () => console.log(`PDF service listening on ${PORT}`));
