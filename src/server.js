// src/server.js  (SVG-first, future-proof)

import express from "express";
import path from "path";
import fsSync from "fs";
import fs from "fs/promises";
import { fileURLToPath } from "url";

import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

import { sendWithGmail } from "./email.js";
import { generateDocument } from "./generators/index.js";
import { normalizeEndorsements } from "./services/endorsements/endorsementNormalizer.js";

// --- LEG 2 / LEG 3 IMPORTS ---
import { processInbox } from "./quote-processor.js";
import { triggerCarrierBind } from "./bind-processor.js";

/* ============================================================
   📍 ESM PATH SETUP (MUST COME FIRST)
   ============================================================ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const PROJECT_ROOT = path.join(__dirname, "..", "..");
const TPL_DIR = path.join(PROJECT_ROOT, "CID_HomeBase", "templates");
/* ============================================================
   📦 LOAD BUNDLES (NOW SAFE)
   ============================================================ */

const bundlesPath = path.join(__dirname, "config", "bundles.json");
const bundles = JSON.parse(fsSync.readFileSync(bundlesPath, "utf8"));

console.log("[BOOT] commit=", process.env.RENDER_GIT_COMMIT, "file=src/server.js");

/* ============================================================
   🟢 CONFIG
   ============================================================ */

const SEGMENT = process.env.SEGMENT || "plumber";

// Netlify/front-end inbound -> template folder name
const TEMPLATE_ALIASES = {
  Accord125: "ACORD125",
  Accord126: "ACORD126",
  Accord140: "ACORD140",
  WCForm: "ACORD130",
  Accord25: "ACORD25",
  ACORD25: "ACORD25",
  Supplemental: "SUPP_BERKLEY_PLUMBER",

  PlumberAccord125: "ACORD125",
  PlumberAccord126: "ACORD126",
  PlumberSupp: "SUPP_BERKLEY_PLUMBER",

  ACORD125: "ACORD125",
  ACORD126: "ACORD126",
  ACORD130: "ACORD130",
  ACORD140: "ACORD140",
  SUPP_BERKLEY_PLUMBER: "SUPP_BERKLEY_PLUMBER",
};

// Template folder -> output filename
const FILENAME_MAP = {
  ACORD125: "ACORD-125.pdf",
  ACORD126: "ACORD-126.pdf",
  ACORD130: "ACORD-130.pdf",
  ACORD140: "ACORD-140.pdf",
  ACORD25: "ACORD-25.pdf",
  SUPP_BERKLEY_PLUMBER: "Supplemental-Application.pdf",
};

const resolveTemplate = (name) => TEMPLATE_ALIASES[name] || name;

// Convention-based form_id (no hardcoding required for new ACORD forms)
function formIdForTemplateFolder(folderName) {
  const n = String(folderName || "").trim();

  // ACORD130 → acord130
  const m = n.match(/^ACORD(\d+)$/i);
  if (m) return `acord${m[1]}`;

  // SUPP_BERKLEY_PLUMBER → supp_<segment>
  if (/^SUPP_/i.test(n)) return `supp_${SEGMENT}`;

  // EVERYTHING ELSE (LESSOR_A129S, HVAC_SUPP_01, etc.)
  return n.toLowerCase();
}

async function renderTemplatesToAttachments(templateFolders, data) {
  const results = [];

  for (const folderName of templateFolders) {
    const name = resolveTemplate(folderName);

    const unified = await maybeMapData(name, data);

    // GOLD STANDARD: template decides form_id; backend decides segment
    unified.form_id = formIdForTemplateFolder(name);
    unified.segment = SEGMENT;

    try {
      const { buffer } = await generateDocument(unified);
      const filename = FILENAME_MAP[name] || `${name}.pdf`;

      results.push({
        status: "fulfilled",
        value: { filename, buffer, contentType: "application/pdf" },
      });
    } catch (err) {
      results.push({ status: "rejected", reason: err?.message || String(err) });
    }
  }

  const attachments = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  return { attachments, results };
}


// --- Paths (HomeBase mounted as vendor) ---


/* ============================================================
   🔴 APP
   ============================================================ */

const APP = express();
APP.use(express.json({ limit: "20mb" }));

APP.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

APP.get("/healthz", (_req, res) => res.status(200).send("ok"));

/* ============================================================
   🧠 SUPABASE
   ============================================================ */

let supabase = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log("[Robot] SUPABASE_URL:", process.env.SUPABASE_URL);
} else {
  console.warn(
    "[Robot] Supabase ENV missing — local render-only mode enabled"
  );
}

/* ============================================================
   🧩 MAPPING
   ============================================================ */
  async function maybeMapData(templateName, rawData) {
  // RSS LOCK: Legacy mapping disabled.
  // SVG engine owns mapping via templateDir/mapping/page-*.map.json
  return rawData || {};
}


/* ============================================================
   🧾 RENDER / EMAIL (SVG FACTORY)
   ============================================================ */

async function renderBundleAndRespond({ templates, email, debug = false }, res) {
  if (!Array.isArray(templates) || templates.length === 0) {
    return res.status(400).json({ ok: false, error: "NO_TEMPLATES" });
  }

  const results = [];

  for (const t of templates) {
    const name = resolveTemplate(t.name);


    const rawData = t.data || {};
const unified = await maybeMapData(name, rawData);

// GOLD STANDARD: template folder decides form_id (no caller/mapping overrides)
unified.form_id = formIdForTemplateFolder(name);

// GOLD STANDARD: backend decides segment (no caller overrides)
unified.segment = SEGMENT;


    try {
      const { buffer } = await generateDocument(unified);
      const prettyName = FILENAME_MAP[name] || t.filename || `${name}.pdf`;
      results.push({
        status: "fulfilled",
        value: { filename: prettyName, buffer, contentType: "application/pdf" },
      });
    } catch (err) {
      results.push({ status: "rejected", reason: err?.message || String(err) });
    }
  }

  const attachments = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

   // ✅ ADD THIS BLOCK
  if (debug) {
    return res.json({
      ok: true,
      debug: true,
      fulfilled: attachments.map((a) => a.filename),
      rejected: results.filter((r) => r.status === "rejected"),
    });
  }

  if (email?.to?.length) {
    await sendWithGmail({
      to: email.to,
      subject: email.subject || "Submission Packet",
      formData: email.formData,
      html: email.bodyHtml,
      attachments,
    });
    return res.json({
      ok: true,
      success: true,
      sent: true,
      count: attachments.length,
      rejected: results.filter((r) => r.status === "rejected").length,
    });
  }

  if (attachments.length > 0) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${attachments[0].filename}"`
    );
    return res.send(attachments[0].buffer);
  }

  return res.status(500).send("No valid PDFs were generated.");
}

/* ============================================================
   ✅ ROUTES
   ============================================================ */

// Render Bundle Endpoint
APP.post("/render-bundle", async (req, res) => {
  try {
    await renderBundleAndRespond(req.body || {}, res);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Render PDF Endpoint (returns binary PDF for curl > file.pdf)
APP.post("/render-pdf", async (req, res) => {
  try {
    // Expect same payload shape as render-bundle:
    // { templates:[{name,data}], debug?:true }
    const body = req.body || {};
    const templates = Array.isArray(body.templates) ? body.templates : [];

    if (!templates.length) {
      return res.status(400).json({ ok: false, error: "MISSING_TEMPLATES" });
    }

    // If your system supports multiple templates, we keep it simple:
    // return the FIRST rendered PDF as the response body.
    // (You can extend later for ZIP or merged PDFs, but RSS says keep it simple.)
    const first = templates[0];

    // IMPORTANT: use the SAME rendering path the bundle uses
    // We call your existing bundle renderer in a "capture" mode.
    // -----
    // This assumes you already have a helper that can render templates into attachments/buffers.
    // In your codebase, you already use: renderTemplatesToAttachments(templateFolders, renderData)
    // So we reuse that.
    // -----

    // Resolve the template folder(s) exactly like Factory would.
    // Your Factory path is driven by form_id and templatePath in config.
    // For this endpoint, we rely on your existing "resolveTemplate" + "FILENAME_MAP"
    // and the same "renderBundleAndRespond" logic would pick.
    //
    // BUT we want a direct PDF return, so we call the same internal renderer
    // you already use for COI: renderTemplatesToAttachments()

    const templateName = first.name;
    const renderData = first.data || {};

    // This must exist in your server.js already (it does, because COI uses it)
    const templateFolder = resolveTemplate(templateName); // e.g. "ACORD125"
    if (!templateFolder) {
      return res.status(400).json({ ok: false, error: "UNKNOWN_TEMPLATE", template: templateName });
    }

    // Convert form_id/template name to the folder path list expected by renderer
    // In your code you used templateFolders = formIds.map(templateFolderForFormId)
    // For a direct template, we just pass [templateFolder]
    const templateFolders = [templateFolder];

    const { attachments } = await renderTemplatesToAttachments(templateFolders, renderData);

    if (!attachments || !attachments.length) {
      return res.status(500).json({ ok: false, error: "NO_PDF_RETURNED" });
    }

    // attachments items typically look like: { filename, contentType, content/base64/buffer }
    const a0 = attachments[0];

    // Normalize to Buffer (handles Buffer, base64 string, or { data: [...] } cases)
let pdfBuffer = null;

// Sometimes attachments[0] is already a Buffer
if (Buffer.isBuffer(a0)) {
  pdfBuffer = a0;
}

// Most common: a0.content is Buffer or base64 string
else if (Buffer.isBuffer(a0.content)) {
  pdfBuffer = a0.content;
} else if (typeof a0.content === "string") {
  pdfBuffer = Buffer.from(a0.content, "base64");
}

// Some libs use a0.buffer
else if (Buffer.isBuffer(a0.buffer)) {
  pdfBuffer = a0.buffer;
} else if (typeof a0.buffer === "string") {
  pdfBuffer = Buffer.from(a0.buffer, "base64");
}

// Some libs use a0.data
else if (Buffer.isBuffer(a0.data)) {
  pdfBuffer = a0.data;
} else if (typeof a0.data === "string") {
  pdfBuffer = Buffer.from(a0.data, "base64");
} else if (Array.isArray(a0.data)) {
  pdfBuffer = Buffer.from(a0.data);
}

// Validate
if (
  !pdfBuffer ||
  pdfBuffer.length < 4 ||
  pdfBuffer.subarray(0, 4).toString("utf8") !== "%PDF"
) {
  return res.status(500).json({ ok: false, error: "INVALID_PDF_BUFFER" });
}

    const outName = a0.filename || `${templateName}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    return res.status(200).send(pdfBuffer);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Submit Quote Endpoint (LEG 1)
APP.post("/submit-quote", async (req, res) => {
  try {
    const { formData = {}, segments = [], email } = req.body || {};

    const templates = (segments || []).map((name) => ({
      name,
      filename: FILENAME_MAP[resolveTemplate(name)] || `${name}.pdf`,
      data: formData,
    }));

    if (templates.length === 0) {
      return res
        .status(400)
        .json({ ok: false, success: false, error: "NO_VALID_SEGMENTS" });
    }

    const defaultTo = process.env.CARRIER_EMAIL || process.env.GMAIL_USER;
    const emailBlock = email?.to?.length
      ? email
      : {
          to: [defaultTo].filter(Boolean),
          subject: `New Submission — ${formData.applicant_name || ""}`.trim(),
          formData,
        };

    await renderBundleAndRespond({ templates, email: emailBlock }, res);
  } catch (e) {
    res.status(500).json({ ok: false, success: false, error: e.message });
  }
});

// COI Request Endpoint (LEG 3 entry)
APP.post("/request-coi", async (req, res) => {
  try {
    const {
  segment,
  policy_id,

  // holder
  holder_name,
  holder_address,
  holder_city_state_zip,
  holder_email,

  // delivery
  user_email,

  // legacy free text (keep)
  description_special_text,

  // ✅ NEW (safe defaults)
  bundle_id = "COI_STANDARD",
  additional_insureds = [],
  special_wording_text = "",
  special_wording_confirmed = false,
  supporting_uploads = [],
} = req.body || {};
if (special_wording_text && !special_wording_confirmed) {
  return res.status(400).json({
    ok: false,
    error: "WORDING_NOT_CONFIRMED",
  });
}


    if (!segment) return res.status(400).json({ ok: false, error: "MISSING_SEGMENT" });

    const { codes: endorsements_needed } =
      normalizeEndorsements(description_special_text || "");

    const recipientEmail = user_email || holder_email || null;

    const { data, error } = await supabase
      .from("coi_requests")
      .insert({
  segment: segment || SEGMENT,
  bundle_id,

  user_email: recipientEmail,
  policy_id: policy_id || null,

  holder_name: holder_name || null,
  holder_address: holder_address || null,
  holder_city_state_zip: holder_city_state_zip || null,
  holder_email: holder_email || null,

  description_special_text: description_special_text || null,
  endorsements_needed: endorsements_needed?.length ? endorsements_needed : null,

  // ✅ NEW (already added to DB)
  additional_insureds: Array.isArray(additional_insureds)
    ? additional_insureds
    : [],
  special_wording_text: special_wording_text || null,
  special_wording_confirmed: !!special_wording_confirmed,
  supporting_uploads: Array.isArray(supporting_uploads)
    ? supporting_uploads
    : [],

  status: "pending",
})

      .select()
      .single();

    if (error) throw error;

    return res.json({ ok: true, request_id: data.id, endorsements_needed });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// LEG 2: Check Quotes
APP.post("/check-quotes", async (req, res) => {
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || "";
  const serviceEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const impersonatedUser = (process.env.GMAIL_USER || "").trim();
  const privateKey = rawKey.replace(/\\n/g, "\n");

  if (!serviceEmail || !impersonatedUser || !rawKey || !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing Env Vars" });
  }

  try {
    const jwtClient = new google.auth.JWT(
      serviceEmail,
      null,
      privateKey,
      ["https://www.googleapis.com/auth/gmail.modify"],
      impersonatedUser
    );
    await jwtClient.authorize();
    const result = await processInbox(jwtClient);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// LEG 3: Bind Quote
APP.get("/bind-quote", async (req, res) => {
  const quoteId = req.query.id;
  if (!quoteId) return res.status(400).send("Quote ID is missing.");

  try {
    await triggerCarrierBind({ quoteId });
    return res.status(200).send(`
      <!DOCTYPE html>
      <html><head><title>Bind Request Received</title></head>
      <body style="text-align:center; padding:50px; font-family:sans-serif;">
        <h1 style="color:#10b981;">Bind Request Received</h1>
        <p>We are processing your request for Quote ID: <b>${String(quoteId).substring(
          0,
          8
        )}</b>.</p>
      </body></html>
    `);
  } catch {
    return res.status(500).send("Error processing bind request.");
  }
});

/* ============================================================
   🚀 SERVER START
   ============================================================ */

const PORT = process.env.PORT || 8080;
APP.listen(PORT, () => console.log(`PDF service listening on ${PORT}`));

/* ============================================================
   🤖 COI SCHEDULER
   ============================================================ */

let COI_TICK_RUNNING = false;

cron.schedule("*/2 * * * *", async () => {
  if (COI_TICK_RUNNING) return;
  COI_TICK_RUNNING = true;

  try {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase
      .from("coi_requests")
      .update({
        status: "pending",
        error_message: "Re-queued after stale processing timeout",
        error_code: "STALE_PROCESSING_REQUEUE",
        error_at: new Date().toISOString(),
      })
      .eq("status", "processing")
      .lt("processing_started_at", tenMinAgo);

    const { data: rows, error: selErr } = await supabase
      .from("coi_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);

    if (selErr || !rows || rows.length === 0) return;

    const reqRow = rows[0];
    const nowIso = new Date().toISOString();

    const { data: claimed, error: claimErr } = await supabase
      .from("coi_requests")
      .update({
        status: "processing",
        attempt_count: (reqRow.attempt_count ?? 0) + 1,
        last_attempt_at: nowIso,
        processing_started_at: nowIso,
        error_message: null,
        error_code: null,
        error_at: null,
      })
      .eq("id", reqRow.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (claimErr || !claimed) return;

    // Bundle-based COI render (no hardcoded form_id)
const bundleId = claimed.bundle_id || "COI_STANDARD";
const formIds = bundles[bundleId];

if (!Array.isArray(formIds) || formIds.length === 0) {
  throw new Error(`Unknown/empty bundle_id: ${bundleId}`);
}

const templateFolders = formIds
  .map(templateFolderForFormId)
  .filter(Boolean);

if (!templateFolders.length) {
  throw new Error(`Bundle "${bundleId}" produced no template folders`);
}

// Build deterministic printable wording block (no extraction)
const endorsementsText = Array.isArray(claimed.endorsements_needed)
  ? claimed.endorsements_needed.join(", ")
  : "";

const aiText = Array.isArray(claimed.additional_insureds)
  ? claimed.additional_insureds.map((x) => x?.name).filter(Boolean).join("; ")
  : "";

const specialWording = claimed.special_wording_text || "";

const lines = [];
if (endorsementsText) lines.push(`Endorsements: ${endorsementsText}`);
if (aiText) lines.push(`Additional Insured(s): ${aiText}`);
if (specialWording) lines.push(`Special Wording: ${specialWording}`);

const renderData = {
  ...claimed,
  segment: SEGMENT, // backend decides
  // ACORD25 already prints this today; keep contract stable
  description_special_text: lines.length
    ? lines.join("\n")
    : claimed.description_special_text,
};

const { attachments } = await renderTemplatesToAttachments(templateFolders, renderData);

if (!attachments.length) {
  throw new Error("COI bundle produced no PDFs");
}


    const doneIso = new Date().toISOString();
    await supabase
      .from("coi_requests")
      .update({
        status: "completed",
        gmail_message_id: messageId,
        emailed_at: doneIso,
        completed_at: doneIso,
      })
      .eq("id", claimed.id);
  } catch (err) {
    console.error("[COI] Tick crashed:", err?.stack || err);
  } finally {
    COI_TICK_RUNNING = false;
  }
});

/* ============================================================
   📚 LIBRARIAN
   ============================================================ */

cron.schedule("*/10 * * * *", async () => {
  try {
    const { data: docs, error } = await supabase
      .from("carrier_resources")
      .select("*")
      .eq("is_indexed", false)
      .eq("segment", SEGMENT);

    if (error || !docs || docs.length === 0) return;

    for (const doc of docs) {
      await supabase
        .from("carrier_resources")
        .update({
          is_indexed: true,
          indexed_at: new Date().toISOString(),
        })
        .eq("id", doc.id);
    }
  } catch (e) {
    console.error("❌ Librarian Error:", e?.message || e);
  }
});
