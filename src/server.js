import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { renderPdf } from "./pdf.js";
import * as Email from "./email.js";
import { processInbox } from "./quote-processor.js";
const sendWithGmail = Email.sendWithGmail || Email.default || Email.sendEmail;

if (!sendWithGmail) {
  throw new Error("email.js must export sendWithGmail (named) or a default sender.");
}

/* ----------------------------- helpers & consts ---------------------------- */

const enrichFormData = (d) => d || {};

const FILENAME_MAP = {
  PlumberAccord125: "ACORD-125.pdf",
  PlumberAccord126: "ACORD-126.pdf",
  PlumberSupp:      "Plumber-Contractor-Supplemental.pdf"
};

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

APP.get("/healthz", (_req, res) => res.status(200).send("ok"));

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
    return raw;
  }
}

async function renderBundleAndRespond({ templates, email }, res) {
  if (!Array.isArray(templates) || templates.length === 0) {
    return res.status(400).json({ ok: false, error: "NO_TEMPLATES" });
  }

  const results = [];

  for (const t of templates) {
    const name = resolveTemplate(t.name);
    const htmlPath = path.join(TPL_DIR, name, "index.ejs");
    const cssPath  = path.join(TPL_DIR, name, "styles.css");
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

  if (email?.to?.length) {
    try {
      await sendWithGmail({
        to: email.to,
        cc: email.cc,
        subject: email.subject || "Plumber Submission Packet",
        formData: email.formData,
        html: email.bodyHtml,
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

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${attachments[0].filename}"`);
  return res.send(attachments[0].buffer);
}

/* ------------------------------- Leg 1: Submit Quote ---------------------- */

APP.post("/render-bundle", async (req, res) => {
  try {
    await renderBundleAndRespond(req.body || {}, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

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

/* ------------------------------- Leg 2: The Email Robot (Functional) -------------------- */
APP.post("/check-quotes", async (req, res) => {
  console.log("🤖 Robot Waking Up: Checking for new quotes...");

  // 1. Read Credentials
  // GMAIL_USER is the corrected quotes@plumberinsurancedirect.com
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || "";
  const serviceEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const impersonatedUser = (process.env.GMAIL_USER || "").trim();
  const privateKey = rawKey.replace(/\\n/g, '\n'); // Fix for Render newline issues

  // 2. Safety Checks
  if (!serviceEmail || !impersonatedUser) {
    console.error("❌ Error: Missing Email Config (Service Account or Gmail User).");
    return res.status(500).json({ ok: false, error: "Missing Email Config" });
  }
  if (!rawKey || !rawKey.includes("BEGIN PRIVATE KEY")) {
    console.error("❌ Error: Invalid Private Key.");
    return res.status(500).json({ ok: false, error: "Invalid Key" });
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: Missing OPENAI_API_KEY.");
    return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
  }

  try {
    // 3. Connect to Google (WITH IMPERSONATION)
    // Note: googleapis is only imported here to avoid top-level import errors
    const { google } = await import('googleapis'); 

    const jwtClient = new google.auth.JWT(
      serviceEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/gmail.modify'], // Scope to read/modify mailbox
      impersonatedUser 
    );

    // 4. Authorize and Run the Processor
    await jwtClient.authorize();
    const result = await processInbox(jwtClient); // <-- EXECUTES THE CORE LOGIC

    console.log("✅ Robot finished checking inbox.");
    return res.json({ ok: true, ...result });

  } catch (error) {
    const errMsg = error.message || String(error);
    if (errMsg.includes('not authorized to perform this operation')) {
      console.error("🔴 Major Error: Domain-Wide Delegation missing or scopes incorrect.");
      return res.status(500).json({ 
          ok: false, 
          error: "Authentication Failed: Check DWD setup in Google Admin." 
      });
    }
    console.error("❌ Robot Global Error:", errMsg);
    return res.status(500).json({ ok: false, error: errMsg });
  }
});

/* ------------------------------- start server ------------------------------ */

const PORT = process.env.PORT || 10000;
const server = APP.listen(PORT, () => {
  console.log(`Plumber PDF service listening on ${PORT}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
