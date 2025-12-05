// src/email.js - Email sending with Gmail
import nodemailer from "nodemailer";

/**
 * Send email with Gmail
 * @param {Object} options
 * @param {string[]} options.to - Recipient email addresses
 * @param {string[]} options.cc - CC email addresses (optional)
 * @param {string} options.subject - Email subject
 * @param {Object} options.formData - Form data for formatted email body
 * @param {string} options.html - HTML body (fallback if no formData)
 * @param {Array} options.attachments - Array of {filename, buffer} objects
 */
export async function sendWithGmail({ to, cc, subject, formData, html, attachments }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("GMAIL_USER and GMAIL_PASS environment variables required");
  }

  // Create transporter
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  // Build email body from formData if available
  let emailBody = html;
  if (formData) {
    emailBody = buildFormDataEmail(formData);
  }

  // Prepare attachments for nodemailer
  const emailAttachments = (attachments || []).map(({ filename, buffer }) => ({
    filename,
    content: buffer,
  }));

  // Send email
  const mailOptions = {
    from: user,
    to: Array.isArray(to) ? to.join(", ") : to,
    cc: cc && Array.isArray(cc) ? cc.join(", ") : cc,
    subject,
    html: emailBody,
    attachments: emailAttachments,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log("Email sent:", info.messageId);
  return info;
}

/**
 * Build formatted email body from form data
 */
function buildFormDataEmail(data) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ea580c;">New Plumber Insurance Submission</h2>
      
      <h3 style="color: #333; border-bottom: 2px solid #ea580c; padding-bottom: 5px;">Business Information</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0;"><strong>Applicant:</strong></td><td>${data.applicant_name || ""}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Business:</strong></td><td>${data.business_name || ""}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Phone:</strong></td><td>${data.business_phone || ""}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Email:</strong></td><td>${data.contact_email || ""}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Address:</strong></td><td>${data.premise_address || ""}, ${data.premise_city || ""}, ${data.premise_state || ""} ${data.premise_zip || ""}</td></tr>
      </table>

      <h3 style="color: #333; border-bottom: 2px solid #ea580c; padding-bottom: 5px; margin-top: 20px;">Plumbing Operations</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0;"><strong>Years in Business:</strong></td><td>${data.years_in_business || ""}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Years Experience:</strong></td><td>${data.years_experience || ""}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Revenue:</strong></td><td>$${Number(data.projected_gross_revenue || 0).toLocaleString()}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Gas Line Work:</strong></td><td style="color: ${data.gas_line_work === 'Yes' ? '#dc2626' : '#16a34a'}; font-weight: bold;">${data.gas_line_work || "No"}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Boiler Work:</strong></td><td style="color: ${data.boiler_work === 'Yes' ? '#dc2626' : '#16a34a'}; font-weight: bold;">${data.boiler_work || "No"}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>High-Pressure Steam:</strong></td><td style="color: ${data.high_pressure_steam === 'Yes' ? '#dc2626' : '#16a34a'}; font-weight: bold;">${data.high_pressure_steam || "No"}</td></tr>
      </table>

      ${data.industrial_plumbing_clients ? `
      <h3 style="color: #333; border-bottom: 2px solid #ea580c; padding-bottom: 5px; margin-top: 20px;">Industrial Clients</h3>
      <p style="background: #fef3c7; padding: 10px; border-left: 4px solid #f59e0b;">${data.industrial_plumbing_clients}</p>
      ` : ''}

      <h3 style="color: #333; border-bottom: 2px solid #ea580c; padding-bottom: 5px; margin-top: 20px;">Work Breakdown</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0;"><strong>Residential:</strong></td><td>${data.pct_residential || "0"}%</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Commercial:</strong></td><td>${data.pct_commercial || "0"}%</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Industrial:</strong></td><td>${data.pct_industrial || "0"}%</td></tr>
      </table>

      <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">
        <strong>PDFs attached:</strong> ACORD 125, ACORD 126, Contractor Supplemental, Field Names
      </p>
    </div>
  `;
}

// Export default for compatibility
export default sendWithGmail;
