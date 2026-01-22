import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";

import { google } from "googleapis";

import { renderPdf } from "./pdf.js";
import { sendWithGmail } from "./email.js";
import { generateDocument } from "./generators/index.js";

import { normalizeEndorsements } from "./services/endorsements/endorsementNormalizer.js";

// --- LEG 2 / LEG 3 IMPORTS ---
import { processInbox } from "./quote-processor.js";
import { triggerCarrierBind } from "./bind-processor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
   🟢 SECTION 1: CONFIGURATION (PLUMBER SEGMENT)
   ============================================================ */

// 1. Map Frontend Names (from Netlify) to Actual Folder Names (in /Templates)
// 1) Netlify/frontend -> actual folder in /templates
const TEMPLATE_ALIASES = {
  // Accept old inbound names (so nothing breaks)
  "Accord125": "ACORD125",
  "Accord126": "ACORD126",
  "Accord140": "ACORD140",
  "WCForm":    "ACORD130",
  "Accord25":  "ACORD25",
  "ACORD25":   "ACORD25",
  "Supplemental": "SUPP_BERKLEY_PLUMBER",

     // ---- legacy plumber-prefixed inbound names (Netlify old build) ----
  "PlumberAccord125": "ACORD125",
  "PlumberAccord126": "ACORD126",
  "PlumberSupp": "SUPP_BERKLEY_PLUMBER",

  // Preferred inbound names going forward
  "ACORD125": "ACORD125",
  "ACORD126": "ACORD126",
  "ACORD130": "ACORD130",
  "ACORD140": "ACORD140",
  "SUPP_BERKLEY_PLUMBER": "SUPP_BERKLEY_PLUMBER",
};

// 2) Folder -> output filename
const FILENAME_MAP = {
  "ACORD125": "ACORD-125.pdf",
  "ACORD126": "ACORD-126.pdf",
  "ACORD130": "ACORD-130.pdf",
  "ACORD140": "ACORD-140.pdf",
  "ACORD25":  "ACORD-25.pdf",
  "SUPP_BERKLEY_PLUMBER": "Supplemental-Application.pdf",
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
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const HOMEBASE_DIR = path.join(__dirname, "..", "vendor", "CID_HomeBase");
const TPL_DIR = path.join(HOMEBASE_DIR, "templates");
const MAP_DIR = path.join(HOMEBASE_DIR, "mapping");


// =====================================================
// 🧠 Supabase (Single Source of Truth)
// =====================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
console.log("[Robot] SUPABASE_URL:", process.env.SUPABASE_URL);

// --- ROUTES ---
APP.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Helper: Data Mapping
async function maybeMapData(templateName, rawData) {
  try {
    const mapPath = path.join(MAP_DIR, `${templateName}.json`);
    const mapping = JSON.parse(await fs.readFile(mapPath, "utf8"));

    const mapped = JSON.parse(JSON.stringify(rawData)); // deep clone

    for (const [tplKey, formKey] of Object.entries(mapping)) {
      const value = rawData?.[formKey] ?? "";

      // support nested EJS paths like agent_applicant.applicant_name
      const parts = tplKey.split(".");
      let cursor = mapped;

      while (parts.length > 1) {
        const p = parts.shift();
        cursor[p] = cursor[p] || {};
        cursor = cursor[p];
      }

      cursor[parts[0]] = value;
    }

    return mapped;
  } catch (e) {
    console.warn(`⚠️ No mapping applied for ${templateName}`);
    return rawData;
  }
}

// Helper: Render Bundle
async function renderBundleAndRespond({ templates, email }, res) {

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
    const cssPath = path.join(TPL_DIR, name, "styles.css");
    const rawData = t.data || {};
    const unified = await maybeMapData(name, rawData);

    try {
      const { buffer } = await generateDocument({
  requestRow: unified,
  templatePath: `vendor/CID_HomeBase/templates/${name}`
});

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
      attachments,
    });
    return res.json({ ok: true, success: true, sent: true, count: attachments.length });
  }

  if (attachments.length > 0) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${attachments[0].filename}"`);
    return res.send(attachments[0].buffer);
  }

  return res.status(500).send("No valid PDFs were generated.");
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

// 2. Submit Quote Endpoint (LEG 1)
APP.post("/submit-quote", async (req, res) => {
  try {
    let { formData = {}, segments = [], email } = req.body || {};

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

// 2.5 COI Request Endpoint (LEG 3 entry) — creates coi_requests row
APP.post("/request-coi", async (req, res) => {
  try {
    const {
      segment,
      holder_name,
      holder_address,
      holder_city_state_zip,
      holder_email,
      description_special_text,
      policy_id,
      user_email, // optional: support either holder_email or user_email
    } = req.body || {};

    if (!segment) return res.status(400).json({ ok: false, error: "MISSING_SEGMENT" });

    // Normalize endorsements from the description field (can expand later)
    const { codes: endorsements_needed } =
      normalizeEndorsements(description_special_text || "");

    const recipientEmail = user_email || holder_email || null;

    const { data, error } = await supabase
      .from("coi_requests")
      .insert({
        segment,
        user_email: recipientEmail, // worker uses user_email to send
        policy_id: policy_id || null,
        holder_name: holder_name || null,
        holder_address: holder_address || null,
        holder_city_state_zip: holder_city_state_zip || null,
        holder_email: holder_email || null,
        description_special_text: description_special_text || null,
        endorsements_needed: endorsements_needed?.length ? endorsements_needed : null,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    return res.json({ ok: true, request_id: data.id, endorsements_needed });
  } catch (e) {
    console.error("[COI REQUEST ERROR]", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// 3. LEG 2: Check Quotes (LEG 2 robot trigger)
APP.post("/check-quotes", async (req, res) => {
  console.log("🤖 Robot Waking Up: Checking for new quotes...");
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
        <p>We are processing your request for Quote ID: <b>${String(quoteId).substring(0, 8)}</b>.</p>
      </body></html>`;
    return res.status(200).send(confirmationHtml);
  } catch (e) {
    return res.status(500).send("Error processing bind request.");
  }
});

// =====================================================
// 🚀 SERVER START
// =====================================================
const PORT = process.env.PORT || 8080;
APP.listen(PORT, () => console.log(`PDF service listening on ${PORT}`));

// =====================================================
// 🤖 THE ROBOT MANAGER (Automated Tasks)
// =====================================================
// ---- COI Scheduler (SRS-safe) -----------------------------------
let COI_TICK_RUNNING = false;

cron.schedule("*/2 * * * *", async () => {
  if (COI_TICK_RUNNING) {
    console.log("[COI] Tick skipped (already running)");
    return;
  }
  COI_TICK_RUNNING = true;

  console.log("[COI] Tick: checking pending rows...");

  try {
    // 0) (Optional but recommended) Requeue stale "processing" rows (crash/redeploy safety)
    // If a row has been "processing" > 10 minutes, move it back to pending
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

    // 1) Pull oldest pending row
    const { data: rows, error: selErr } = await supabase
      .from("coi_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);

    if (selErr) {
      console.error("[COI] DB select error:", selErr);
      return;
    }

    console.log(`[COI] Pending rows found: ${rows?.length || 0}`);
    if (!rows || rows.length === 0) return;

    const reqRow = rows[0];
    console.log(
      `[COI] Candidate id=${reqRow.id} segment=${reqRow.segment} status="${reqRow.status}"`
    );

    // 2) Claim row (pending -> processing) ATOMIC
    const nowIso = new Date().toISOString();

    const { data: claimed, error: claimErr } = await supabase
      .from("coi_requests")
      .update({
        status: "processing",
        // Don't depend on reqRow being fresh; just increment from DB value if present
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

    if (claimErr) {
      console.error("[COI] Claim error:", claimErr);
      return;
    }
    if (!claimed) {
      console.log(`[COI] Row ${reqRow.id} not claimable (already claimed/processed).`);
      return;
    }

    console.log(`[COI] Claimed id=${claimed.id} -> processing`);

    // 3) Generate PDF (ACORD25)
    // IMPORTANT: If your table does NOT have form_id, DO NOT reference claimed.form_id here.
    const { buffer: pdfBuffer, meta } = await generateDocument({
      ...claimed,
      form_id: "acord25_v1",
    });

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
      throw new Error("PDF generator did not return a Buffer");
    }

    const first5 = pdfBuffer.subarray(0, 5).toString("ascii");
    console.log(`[COI] PDF generated bytes=${pdfBuffer.length} first5="${first5}"`);

    // 4) Decide recipient
    const recipient = claimed.user_email;
    if (!recipient) {
      throw new Error("Missing user_email on coi_requests row");
    }

    // 5) Prepare attachment filename
    const safeHolder = String(claimed.holder_name || "Holder")
      .replace(/[^a-z0-9]/gi, "_")
      .substring(0, 50);

    const filename =
      meta?.filename || `COI-${safeHolder}-${String(claimed.id).substring(0, 8)}.pdf`;

    console.log(`[COI] About to send email to="${recipient}" filename="${filename}"`);

    // 6) Send email
    let info;
    try {
      info = await sendWithGmail({
        to: [recipient],
        subject: `Your Certificate of Insurance - ${claimed.holder_name || ""}`.trim(),
        html: `
          <h3>Certificate Generated</h3>
          <p>Attached is the COI you requested for <b>${claimed.holder_name || "your request"}</b>.</p>
          <p><b>Special Wording Included:</b><br><em>${claimed.description_special_text || "None"}</em></p>
        `,
        attachments: [
          {
            filename,
            buffer: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });
    } catch (sendErr) {
      const msg = (sendErr?.message || String(sendErr)).slice(0, 2000);
      console.error(`[COI] EMAIL SEND FAILED id=${claimed.id} error="${msg}"`);
      console.error(sendErr?.stack || sendErr);

      await supabase
        .from("coi_requests")
        .update({
          status: "error",
          error_message: msg,
          error_code: "COI_SEND_FAILED",
          error_at: new Date().toISOString(),
        })
        .eq("id", claimed.id);

      return;
    }

    // 7) PROOF GATE — do NOT complete without a messageId
    const messageId = info?.messageId;
    if (!messageId) {
      const msg = "Email send returned no messageId (not provable)";
      console.error(`[COI] ${msg} id=${claimed.id}`);

      await supabase
        .from("coi_requests")
        .update({
          status: "error",
          error_message: msg,
          error_code: "NO_GMAIL_MESSAGE_ID",
          error_at: new Date().toISOString(),
        })
        .eq("id", claimed.id);

      return;
    }

    // 8) Mark completed
    const doneIso = new Date().toISOString();
    const { error: doneErr } = await supabase
      .from("coi_requests")
      .update({
        status: "completed",
        gmail_message_id: messageId,
        emailed_at: doneIso,
        completed_at: doneIso,
        error_message: null,
        error_code: null,
        error_at: null,
      })
      .eq("id", claimed.id);

    if (doneErr) {
      console.error("[COI] Email sent but failed to mark completed:", doneErr);
    } else {
      console.log(`[COI] COMPLETED id=${claimed.id} messageId=${messageId}`);
    }
  } catch (err) {
    console.error("[COI] Tick crashed:", err?.stack || err);
  } finally {
    COI_TICK_RUNNING = false;
  }
});


// --- TASK 2: THE LIBRARIAN (Check every 10 minutes) ---
cron.schedule("*/10 * * * *", async () => {
  console.log("📚 Librarian: Checking for unindexed 'plumber' docs...");

  const { data: docs, error } = await supabase
    .from("carrier_resources")
    .select("*")
    .eq("is_indexed", false)
    .eq("segment", "plumber");

  if (error) {
    console.error("❌ Librarian Error:", error.message);
    return;
  }

  if (docs && docs.length > 0) {
    console.log(`📚 Found ${docs.length} new documents to learn.`);

    for (const doc of docs) {
      const { error: updErr } = await supabase
        .from("carrier_resources")
        .update({
          is_indexed: true,
          indexed_at: new Date().toISOString(),
        })
        .eq("id", doc.id);

      if (updErr) console.error("❌ Librarian update error:", updErr);
      else console.log(`🧠 Learned: ${doc.document_title || doc.file_name}`);
    }
  } else {
    console.log("📚 No unindexed documents found.");
  }
});
