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

export const sendWithGmail = async ({ to, subject, html, attachments }) => {
  try {
    // ROBUST FIX: Accepts either 'buffer' or 'content' keys from the Robot
    const emailAttachments = (attachments || []).map((att) => {
      // 1. Find the data (regardless of what the robot named it)
      const raw = att.buffer || att.content; 
      
      // 2. Ensure it is a valid Buffer
      const safeBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || "");

      // 3. HARD PROOF CHECKS (adds certainty)
const magic = safeBuf.slice(0, 5).toString("utf8");
if (magic !== "%PDF-") {
  console.warn(`⚠️ Attachment ${att.filename} is NOT a valid PDF. Magic=${magic}`);
}

if (safeBuf.length < 100) {
  console.warn(`⚠️ Warning: Attachment ${att.filename} is empty or too small (${safeBuf.length} bytes).`);
}


      // 4. Return the format Nodemailer expects
      return {
        filename: att.filename,
        content: safeBuf, 
        contentType: "application/pdf",
      };
    });

    const info = await transporter.sendMail({
      from: `"Plumber Insurance Direct" <${GMAIL_USER}>`,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      html,
      attachments: emailAttachments,
    });

    console.log(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};
