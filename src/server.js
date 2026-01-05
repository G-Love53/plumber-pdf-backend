import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { renderPdf } from "./pdf.js";
import { sendWithGmail } from "./email.js";
import { generateDocument } from "./generators/index.js";



// --- LEG 2 / LEG 3 IMPORTS ---
import { processInbox } from "./quote-processor.js";
import { triggerCarrierBind } from "./bind-processor.js";
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
   🟢 SECTION 1: CONFIGURATION (PLUMBER SEGMENT)
   ============================================================ */

// 1. Map Frontend Names (from Netlify) to Actual Folder Names (in /Templates)
const TEMPLATE_ALIASES = {
  // Generic Name       : Actual Folder Name
  "Accord125":         "PlumberAccord125", 
  "Accord126":         "PlumberAccord126", 
  "Accord140":         "PlumberAccord140", 
  "WCForm":            "WCPlumberForm",     
  "Supplemental":      "PlumberSupp",       
  
  // Self-referencing aliases for safety
  "PlumberAccord125":  "PlumberAccord125",
  "PlumberAccord126":  "PlumberAccord126",
  "PlumberAccord140":  "PlumberAccord140",
};

// 2. Map Folder Names to Pretty Output Filenames
const FILENAME_MAP = {
  "PlumberAccord125": "ACORD-125.pdf",
  "PlumberAccord126": "ACORD-126.pdf",
  "PlumberAccord140": "ACORD-140.pdf",
  "PlumberSupp":      "Supplemental-Application.pdf",
  "WCPlumberForm":    "WC-Application.pdf"
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

// =====================================================
// 🤖 THE ROBOT MANAGER (Automated Tasks)
// =====================================================
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';

// Initialize the Brain (Supabase)
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
console.log('[Robot] SUPABASE_URL:', process.env.SUPABASE_URL);

console.log("🤖 Robot Scheduler: ONLINE and Listening...");

// --- TASK 1: THE COI WATCHER (Check every 2 minutes) ---
cron.schedule("*/2 * * * *", async () => {
  console.log("[COI] Tick: checking pending rows...");

  try {
    // 1) Pull oldest pending row
    const { data: rows, error: selErr } = await supabase
      .from("coi_requests")
      .select("*")
      .eq("status", "pending_coi_v2")
      .order("created_at", { ascending: true })
      .limit(1);

    if (selErr) {
      console.error("[COI] DB select error:", selErr);
      return;
    }

    console.log(`[COI] Pending rows found: ${rows?.length || 0}`);
    if (!rows || rows.length === 0) return;

    const req = rows[0];
    console.log(`[COI] Candidate id=${req.id} segment=${req.segment} status="${req.status}"`);

    // 2) Claim row (pending -> processing) so we don't double-send on restarts/overlap
    const { data: claimed, error: claimErr } = await supabase
      .from("coi_requests")
      .update({
        status: "processing",
        attempts: (req.attempts ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", req.id)
      .eq("status", "pending_coi_v2")
      .select()
      .maybeSingle();

    if (claimErr) {
      console.error("[COI] Claim error:", claimErr);
      return;
    }
    if (!claimed) {
      console.log(`[COI] Row ${req.id} not claimable (already claimed/processed).`);
      return;
    }

    console.log(`[COI] Claimed id=${claimed.id} -> processing`);
    console.log(`[COI] Claimed id=${claimed.id} attempts=${claimed.attempts} last_attempt_at=${claimed.last_attempt_at}`);

    // 3) Generate PDF
    const { buffer: pdfBuffer, meta } = await generateDocument({
      ...claimed,
      form_id: claimed.form_id || "acord25_v1",
    });

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
      throw new Error("PDF generator did not return a Buffer");
    }

    const first5 = pdfBuffer.subarray(0, 5).toString("ascii");
    console.log(`[COI] PDF generated bytes=${pdfBuffer.length} first5="${first5}"`);

    // 4) Decide recipient (do NOT silently default unless you want that)
    const recipient = claimed.user_email;
    if (!recipient) {
      throw new Error("Missing user_email on coi_requests row");
    }

    // 5) Prepare attachment
    const safeHolder = String(claimed.holder_name || "Holder")
      .replace(/[^a-z0-9]/gi, "_")
      .substring(0, 50);

    const filename =
      meta?.filename ||
      `COI-${safeHolder}-${String(claimed.id).substring(0, 8)}.pdf`;

    console.log(`[COI] About to send email to="${recipient}" filename="${filename}"`);

    // 6) Send email (email.js will log PDF magic + messageId)
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
            buffer: pdfBuffer, // supports buffer or content in your email.js
            contentType: "application/pdf",
          },
        ],
      });
    } catch (sendErr) {
      // 7) If send fails, mark row error (PROOF)
      const msg = (sendErr?.message || String(sendErr)).slice(0, 2000);
      console.error(`[COI] EMAIL SEND FAILED id=${claimed.id} error="${msg}"`);
      console.error(sendErr?.stack || sendErr);

      const { error: updErr } = await supabase
        .from("coi_requests")
        .update({
          status: "error",
          error_message: msg,
        })
        .eq("id", claimed.id);

      if (updErr) console.error("[COI] Failed updating status=error:", updErr);
      return;
    }

    // 8) PROOF GATE — do NOT complete without a messageId
const messageId = info?.messageId;

if (!messageId) {
  const msg = "Email send returned no messageId (not provable)";
  console.error(`[COI] ${msg} id=${claimed.id}`);

  await supabase
    .from("coi_requests")
    .update({ status: "error", error_message: msg })
    .eq("id", claimed.id);

  return;
}

// Mark completed ONLY with proof
const { error: doneErr } = await supabase
  .from("coi_requests")
  .update({
    status: "completed",
    gmail_message_id: messageId,
    emailed_at: new Date().toISOString(),
    error_message: null,
  })
  .eq("id", claimed.id);

if (doneErr) {
  console.error("[COI] Email sent but failed to mark completed:", doneErr);
} else {
  console.log(`[COI] COMPLETED id=${claimed.id} messageId=${messageId}`);
}

} catch (err) {
  // Absolute safety net so cron tick never crashes the process
  console.error("[COI] Tick crashed:", err?.stack || err);
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
