// email.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD environment variables required");
}

// Create transporter once
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});

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

export async function sendWithGmail({ to, subject, html, text, attachments = [] }) {
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

  try {
    const info = await transporter.sendMail({
      from: `"CID Service" <${GMAIL_USER}>`,
      to: toStr,
      subject,
      text, // optional
      html,
      attachments: emailAttachments,
    });

    // ✅ Provable success logging
    console.log(`[EMAIL] sent ok messageId=${info.messageId}`);
    return info;
  } catch (err) {
    // ✅ Provable failure logging (don’t swallow)
    console.error(`[EMAIL] sendMail failed to="${toStr}" subject="${subject || ""}"`);
    console.error(err?.stack || err);
    throw err;
  }
}
