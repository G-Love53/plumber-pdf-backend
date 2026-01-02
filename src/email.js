import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD environment variables required");
}

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
  // If someone accidentally passes a base64 string or normal string, still convert
  return Buffer.from(raw);
}

export async function sendWithGmail({ to, subject, html, attachments = [] }) {
  const emailAttachments = (attachments || []).map((att) => {
    const raw = att.buffer ?? att.content; // accept either key
    const buf = toBuffer(raw);

    // Sanity checks (these logs are gold while debugging)
    const magic = buf.slice(0, 5).toString("utf8");
    if (magic !== "%PDF-") {
      console.warn(`⚠️ Attachment not a PDF: ${att.filename} magic="${magic}" bytes=${buf.length}`);
    } else {
      console.log(`✅ Attachment looks like PDF: ${att.filename} bytes=${buf.length}`);
    }

    return {
      filename: att.filename || "attachment.pdf",
      content: buf, // nodemailer expects "content" for Buffers
      contentType: att.contentType || "application/pdf",
    };
  });

  const info = await transporter.sendMail({
    from: `"CID Service" <${GMAIL_USER}>`,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html,
    attachments: emailAttachments,
  });

  console.log(`Email sent: ${info.messageId}`);
  return info;
}
