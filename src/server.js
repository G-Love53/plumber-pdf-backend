// src/server.js - Plumber PDF Service (Complete, Independent)
import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { renderPdf } from "./pdf.js";
import * as Email from "./email.js";
const sendWithGmail = Email.sendWithGmail || Email.default || Email.sendEmail;
if (!sendWithGmail) {
  throw new Error("email.js must export sendWithGmail (named) or a default sender.");
}

/* ----------------------------- helpers & consts ---------------------------- */

// keep shape if no enricher is needed
const enrichFormData = (d) => d || {};

const FILENAME_MAP = {
  PlumberAccord125: "ACORD-125.pdf",
  PlumberAccord126: "ACORD-126.pdf",
  PlumberSupp:      "Plumber-Contractor-Supplemental.pdf"
};

// allow friendlier names from callers
const TEMPLATE_ALIASES = {
  Accord125: "PlumberAccord125",
  Accord126: "PlumberAccord126",
  PlumberAccord125: "PlumberAccord125",
  PlumberAccord126: "PlumberAccord126",
  PlumberSupp: "PlumberSupp"
};
const resolveTemplate = (name) => TEMPLATE_ALIASES[name] || name;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* --------------------------------- express -------------------------------- */
const APP = express();
APP.use(express.json({ limit: "20mb" }));

// CORS (limit to configured origins if provided)
const allowed = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

APP.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!allowed.length || (origin && allowed.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* --------------------------------- dirs ----------------------------------- */
const TPL_DIR = path.join(__dirname, "..", "Templates");
const MAP_DIR = path.join(__dirname, "..", "mapping");

/* -------------------------------- routes ---------------------------------- */

// health
APP.get("/healthz", (_req, res) => res.status(200).send("ok"));

// optional mapping: mapping/<template>.json
async function maybeMapData(templateName, raw) {
  try {
    const mapPath = path.join(MAP_DIR, `${templateName}.json`);
    const mapping = JSON.parse(await fs.readFile(mapPath, "utf8"));
    const mapped = {};
    for (const [tplKey, formKey] of Object.entries(mapping)) {
      mapped[tplKey] = raw?.[formKey] ?? "";
    }
    return { ...raw, ...mapped };
  } catch {
    // no mapping file, pass through
    return raw;
  }
}

// core renderer that both endpoints use
async function renderBundleAndRespond({ templates, email }, res) {
  if (!Array.isArray(templates) || templates.length === 0) {
    return res.status(400).json({ ok: false, error: "NO_TEMPLATES" });
  }

  const results = [];

  for (const t of templates) {
    const name = resolveTemplate(t.name);
    const htmlPath = path.join(TPL_DIR, name, "index.ejs");
    const cssPath  = path.join(TPL_DIR, name, "styles.css"); // optional
    const rawData  = t.data || {};
    const unified  = await maybeMapData(name, rawData);

    try {
      const buffer = await renderPdf({ htmlPath, cssPath, data: unified });
      const filename = t.filename || FILENAME_MAP[name] || `${name}.pdf`;
      results.push({ status: "fulfilled", value: { filename, buffer } });
    } catch (err) {
      results.push({ status: "rejected", reason: err });
    }
  }

  const failures = results.filter(r => r.status === "rejected");
  if (failures.length) {
    console.error("RENDER_FAILURES", failures.map(f => String(f.reason)));
    return res.status(500).json({
      ok: false,
      success: false,
      error: "ONE_OR_MORE_ATTACHMENTS_FAILED",
      failedCount: failures.length,
      details: failures.map(f => String(f.reason)),
    });
  }

  const attachments = results.map(r => r.value);

  // Email branch
  if (email?.to?.length) {
    try {
      await sendWithGmail({
        to: email.to,
        cc: email.cc,
        subject: email.subject || "Plumber Submission Packet",
        formData: email.formData, // preferred for template-based emails
        html: email.bodyHtml,     // fallback body
        attachments,
      });
      return res.json({ ok: true, success: true, sent: true, count: attachments.length });
    } catch (err) {
      console.error("EMAIL_SEND_FAILED", err);
      return res.status(502).json({
        ok: false,
        success: false,
        error: "EMAIL_SEND_FAILED",
        detail: String(err?.message || err),
      });
    }
  }

  // Fallback: return first PDF directly
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${attachments[0].filename}"`);
  return res.send(attachments[0].buffer);
}

/* ------------------------------- public APIs ------------------------------- */

// JSON API: { templates:[{name,filename?,data}], email? }
APP.post("/render-bundle", async (req, res) => {
  try {
    await renderBundleAndRespond(req.body || {}, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Back-compat: { formData, segments[], email? }
APP.post("/submit-quote", async (req, res) => {
  try {
    let { formData = {}, segments = [], email } = req.body || {};
    formData = enrichFormData(formData);

    const templates = (segments || [])
      .map((n) => resolveTemplate(n))
      .map((name) => ({
        name,
        filename: FILENAME_MAP[name] || `${name}.pdf`,
        data: formData,
      }));

    if (!templates.length) {
      return res.status(400).json({ ok: false, success: false, error: "NO_VALID_SEGMENTS" });
    }

    // default email so this endpoint returns JSON (not a PDF stream)
    const defaultTo = process.env.CARRIER_EMAIL || process.env.GMAIL_USER;
    const cc = (process.env.UW_EMAIL || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const emailBlock = email?.to?.length
      ? email
      : {
          to: [defaultTo].filter(Boolean),
          cc,
          subject: `New Plumber Submission — ${formData.business_name || formData.applicant_name || ""}`,
          formData,
        };

    await renderBundleAndRespond({ templates, email: emailBlock }, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, success: false, error: e.message || String(e) });
  }
});
/* ------------------------------- Leg 2: The Email Robot -------------------- */
// This is the missing endpoint that wakes up the robot to check emails
APP.post("/check-quotes", async (req, res) => {
  console.log("🤖 Robot Waking Up: Checking for new quotes...");

  // 1. Check if we have the Private Key
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  if (!privateKey || !serviceEmail) {
    console.error("❌ Missing Google Credentials");
    return res.status(500).json({ ok: false, error: "Missing GOOGLE_PRIVATE_KEY or EMAIL in Env Vars" });
  }

  try {
    // 2. Prepare the Authentication (The Robot's ID Badge)
    // We are dynamically importing to avoid crashes if you missed the npm install
    // If this fails, we will know you need to add 'googleapis' to your package.json
    const { google } = await import('googleapis'); 
    
    const jwtClient = new google.auth.JWT(
      serviceEmail,
      null,
      privateKey.replace(/\\n/g, '\n'), // Fix formatting issues
      ['https://www.googleapis.com/auth/gmail.modify']
    );

    // 3. Connect to Gmail
    await jwtClient.authorize();
    const gmail = google.gmail({ version: 'v1', auth: jwtClient });

    // 4. Look for the Label 'CID/CarrierQuotes'
    // (We search for the label ID first to be safe)
    const labelList = await gmail.users.labels.list({ userId: 'me' });
    const quoteLabel = labelList.data.labels.find(l => l.name === 'CID/CarrierQuotes');

    if (!quoteLabel) {
      return res.json({ ok: true, message: "Connected to Gmail, but 'CID/CarrierQuotes' label not found." });
    }

    // 5. Success! The Robot can see the account.
    return res.json({ 
      ok: true, 
      message: "✅ Robot connected successfully!", 
      foundLabelId: quoteLabel.id 
    });

  } catch (error) {
    console.error("❌ Robot Error:", error);
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});
/* ------------------------------- start server ------------------------------ */

const PORT = process.env.PORT || 10000;
const server = APP.listen(PORT, () => {
  console.log(`Plumber PDF service listening on ${PORT}`);
});

// graceful shutdown to avoid npm SIGTERM noise
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref(); // safety
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
