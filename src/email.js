// email.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

let transporter = null;

// Support both GMAIL_* (Bar/Roofer) and EMAIL_* (Plumber / per-URL config)
function getTransporter() {
  const user = process.env.GMAIL_USER || process.env.EMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "Email credentials required: set GMAIL_USER and GMAIL_APP_PASSWORD, or EMAIL_USER and EMAIL_APP_PASSWORD"
    );
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }
  return transporter;
}

// Shared HTML summary (Bar info + Plumber-style attachments note)
function generateEmailSummary(formData = {}, attachments = []) {
  const safe = (v) => (v == null || v === "" ? "N/A" : String(v));

  const attachmentNames = (attachments || [])
    .map((a) => a?.filename)
    .filter(Boolean);

  const attachmentsLine = attachmentNames.length
    ? `<p style="text-align:center; padding:0 20px 20px 20px; font-size:0.95em; color:#444;">
        PDFs attached: ${attachmentNames.join(", ")}
       </p>`
    : "";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
        .header { background-color: #ff8c00; color: white; padding: 12px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 20px; background-color: #f5f5f5; margin: 20px; border-radius: 8px; }
        .field { margin: 10px 0; }
        .label { font-weight: bold; }
        .footer { padding: 20px; text-align: center; color: #666; font-size: 0.9em; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Commercial Insurance Quote Request</h1>
      </div>
      
      <div class="content">
        <h3>Applicant Information:</h3>
        
        <div class="field">
          <span class="label">Business Name:</span> ${safe(formData.applicant_name || formData.insured_name)}
        </div>
        
        <div class="field">
          <span class="label">Premises Name:</span> ${safe(formData.premises_name)}
        </div>
        
        <div class="field">
          <span class="label">Address:</span> ${safe(formData.premise_address || formData.mailing_address)}
        </div>
        
        <div class="field">
          <span class="label">Phone:</span> ${safe(formData.business_phone || formData.applicant_phone)}
        </div>
        
        <div class="field">
          <span class="label">Email:</span> ${safe(formData.contact_email)}
        </div>
        
        <div class="field">
          <span class="label">Effective Date:</span> ${safe(formData.effective_date || formData.policy_effective_date)}
        </div>
        
        <div class="field">
          <span class="label">Would Like A Building Quote:</span> ${safe(formData.building_quote)}
        </div>
        
        <div class="field">
          <span class="label">Workers Comp Quote:</span> ${safe(formData.workers_comp_quote)}
        </div>
        
        <div class="field">
          <span class="label">Total Sales:</span> ${safe(formData.total_sales)}
        </div>
      </div>
      
      <p style="text-align: center; padding: 10px 20px 0 20px;">
        Please find the completed application forms attached. We look forward to your competitive quote.
      </p>
      ${attachmentsLine}
      
      <div class="footer">
        <strong>Commercial Insurance Direct LLC</strong><br/>
        Phone: (303) 932-1700<br/>
        Email: <a href="mailto:quote@barinsurancedirect.com">quote@barinsurancedirect.com</a>
      </div>
    </body>
    </html>
  `;
}

// Helper: force anything into a Buffer safely
function toBuffer(raw) {
  if (!raw) return Buffer.alloc(0);
  if (Buffer.isBuffer(raw)) return raw;
  return Buffer.from(raw);
}

function asRecipientString(to) {
  if (Array.isArray(to)) return to.join(", ");
  return to || "";
}

export async function sendWithGmail({
  to,
  subject,
  html,
  text,
  formData,
  attachments = [],
}) {
  const transport = getTransporter();
  const fromUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
  const toStr = asRecipientString(to);

  // ✅ Provable top-level logging
  console.log(
    `[EMAIL] to="${toStr}" subject="${subject || ""}" attachments=${attachments?.length || 0}`
  );

  const emailAttachments = (attachments || []).map((att, idx) => {
    const raw = att?.buffer ?? att?.content; // accept either key
    const buf = toBuffer(raw);

    // ✅ Provable attachment logging (first bytes + size)
    const first5Ascii = buf.subarray(0, 5).toString("ascii");
    const first5Hex = buf.subarray(0, 5).toString("hex");
    const filename = att?.filename || `attachment-${idx}.pdf`;

    if (first5Ascii !== "%PDF-") {
      console.warn(
        `[EMAIL] ⚠️ Attachment[${idx}] not PDF-ish: filename="${filename}" first5="${first5Ascii}" hex=${first5Hex} bytes=${buf.length}`
      );
    } else {
      console.log(
        `[EMAIL] ✅ Attachment[${idx}] looks like PDF: filename="${filename}" first5="${first5Ascii}" bytes=${buf.length}`
      );
    }

    return {
      filename,
      content: buf, // nodemailer expects "content" for Buffers
      contentType: att?.contentType || "application/pdf",
    };
  });

  const emailHtml =
    formData && Object.keys(formData || {}).length > 0
      ? generateEmailSummary(formData, emailAttachments)
      : html;

  try {
    const info = await transport.sendMail({
      from: `"CID Service" <${fromUser}>`,
      to: toStr,
      subject,
      text, // optional
      html: emailHtml,
      attachments: emailAttachments,
    });

    // ✅ Provable success logging
    console.log(`[EMAIL] sent ok messageId=${info.messageId}`);
    return info;
  } catch (err) {
    // ✅ Provable failure logging (don’t swallow)
    console.error(
      `[EMAIL] sendMail failed to="${toStr}" subject="${subject || ""}"`
    );
    console.error(err?.stack || err);
    throw err;
  }
}
