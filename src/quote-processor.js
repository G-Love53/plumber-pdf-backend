import { google } from 'googleapis';
import { simpleParser } from 'mailparser';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { loadPrompts } from "./services/promptLoader.js"; 

/* ---------------- Configuration ---------------- */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
let openai;
if (OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
}

// 👇 THE MAGIC: Defaults to 'bar' if you forget to set it in Render
const SEGMENT = process.env.SEGMENT_NAME || 'bar'; 

/**
 * Processes incoming emails labeled 'CID/CarrierQuotes'.
 */
export async function processInbox(authClient) {
  console.log(`Starting Quote Ingestion for Segment: [ ${SEGMENT} ]`);
  
  // 1. Load the Brains dynamically
  let globalSystem, segmentPersona;
  try {
    const prompts = loadPrompts(SEGMENT);
    globalSystem = prompts.globalSystem;
    segmentPersona = prompts.segmentPersona;
  } catch (err) {
    console.error("❌ Error loading prompts:", err.message);
    return { status: "Error loading prompts" };
  }

  const combinedSystemPrompt = `${globalSystem}\n\n${segmentPersona}`;

  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const results = [];

  // 2. Find Unread Quotes
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'label:CID/CarrierQuotes is:unread has:attachment',
    maxResults: 5 
  });

  const messages = res.data.messages || [];
  if (messages.length === 0) return { status: "No new quotes to process" };

  for (const message of messages) {
    try {
      // 3. Fetch Email & PDF
      const msgData = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'raw' });
      const decodedEmail = Buffer.from(msgData.data.raw, 'base64');
      const parsed = await simpleParser(decodedEmail);
      
      const pdfAttachment = parsed.attachments.find(att => att.contentType === 'application/pdf');
      if (!pdfAttachment) {
        console.log(`Skipping - No PDF found.`);
        continue;
      }

      const pdfData = await pdf(pdfAttachment.content);
      const rawText = pdfData.text;

      // 4. AI Analysis
      const quoteId = randomUUID();
      
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: combinedSystemPrompt },
          { role: "user", content: `Analyze this PDF Quote Text:\n${rawText}\n\nGenerate the JSON response.` }
        ],
        response_format: { type: "json_object" }
      });

      const aiContent = JSON.parse(aiResponse.choices[0].message.content);

      // 5. Construct the Email (With Quality Gate)
      const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:10000';
      const bindUrl = `https://${hostname}/bind-quote?id=${quoteId}`;
      const bindButton = `<a href="${bindUrl}" style="background-color: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin: 20px 0;">CLICK HERE TO BIND NOW</a>`;

      let qualityWarning = "";
      if (aiContent.risk_flags && aiContent.risk_flags.length > 0) {
         qualityWarning = `<div style="background: #fee2e2; color: #b91c1c; padding: 15px; border: 1px solid #b91c1c; border-radius: 5px; margin-bottom: 20px;">
           <strong>⚠️ INTERNAL SAFETY FLAG:</strong> The AI found risks: ${aiContent.risk_flags.join(', ')}
         </div>`;
      }

      const finalEmailBody = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          ${qualityWarning}
          ${aiContent.sales_email_html}
          ${bindButton}
          <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
          <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; border-left: 5px solid #2563EB;">
            <h3 style="margin-top: 0; color: #2563EB;">📋 Policy Coverage Breakdown</h3>
            <p><strong>Carrier:</strong> ${aiContent.carrier} | <strong>Premium:</strong> ${aiContent.premium}</p>
            ${aiContent.policy_breakdown_html}
          </div>
        </div>
      `;

      // 6. Save Draft
      const rawDraft = makeRawEmail({
        to: parsed.from.value[0].address,
        subject: `RE: ${parsed.subject} - Proposal Ready`,
        body: finalEmailBody,
        threadId: message.threadId
      });

      await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { threadId: message.threadId, raw: rawDraft } }
      });

      // 7. Mark Processed
      await gmail.users.messages.modify({
        userId: 'me',
        id: message.id,
        requestBody: { removeLabelIds: ['UNREAD'] }
      });

      results.push({ id: message.id, status: "Draft Created", quoteId });

    } catch (err) {
      console.error(`❌ Error on msg ${message.id}:`, err);
      results.push({ id: message.id, error: err.message });
    }
  }

  return { processedCount: results.length, results };
}

function makeRawEmail({ to, subject, body, threadId }) {
  const str = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body
  ].join('\n');
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}
