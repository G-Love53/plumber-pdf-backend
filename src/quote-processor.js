import { google } from 'googleapis';
import { simpleParser } from 'mailparser';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';

/* ---------------- Configuration ---------------- */
// Ensure API Key is available
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
let openai;
if (OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
} else {
    console.warn("⚠️ OPENAI_API_KEY is missing. AI features will fail.");
}

/**
 * Processes incoming emails labeled 'CID/CarrierQuotes'.
 * @param {google.auth.JWT} authClient - The authenticated Google JWT client.
 * @returns {Object} Processing results.
 */
export async function processInbox(authClient) {
  console.log("Starting Quote Ingestion...");
  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const results = [];

  // 1. Find Unread Quotes
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'label:CID/CarrierQuotes is:unread has:attachment',
    maxResults: 5 
  });

  const messages = res.data.messages || [];
  if (messages.length === 0) return { status: "No new quotes to process" };

  console.log(`Found ${messages.length} new quote(s).`);

  for (const message of messages) {
    let subject = 'Unknown Subject';
    try {
      // 2. Fetch Email Content
      const msgData = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'raw'
      });
      
      const decodedEmail = Buffer.from(msgData.data.raw, 'base64');
      const parsed = await simpleParser(decodedEmail);
      
      subject = parsed.subject;
      const from = parsed.from.value[0].address;
      
      // 3. Find PDF Attachment
      const pdfAttachment = parsed.attachments.find(att => att.contentType === 'application/pdf');
      if (!pdfAttachment) {
        console.log(`Skipping ${subject} - No PDF found.`);
        results.push({ id: message.id, status: "Skipped: No PDF" });
        continue;
      }

      // 4. Extract Text using pdf-parse (Inbound Reader)
      const pdfData = await pdf(pdfAttachment.content);
      const rawText = pdfData.text;

      // 5. AI Analysis (The Salesman)
      const quoteId = randomUUID(); // Unique ID for Leg 3 Binding
      
      if (!openai) throw new Error("OpenAI Client not initialized");

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert insurance underwriter assistant. 
            Analyze the attached carrier quote text.
            
            Task 1: Extract Premium, Carrier Name, Subjectivities.
            Task 2: Write a persuasive sales email for the client.
            Task 3: Embed the Bind Link placeholder [BIND_LINK_PLACEHOLDER].
            
            Return JSON: { 
              "premium": "Number", 
              "carrier": "String", 
              "subjectivities": ["List"], 
              "sales_email_html": "HTML String", 
              "quote_id": "${quoteId}" 
            }`
          },
          { role: "user", content: `Quote Text:\n${rawText}` }
        ],
        response_format: { type: "json_object" }
      });

      const contentString = aiResponse.choices[0].message.content;
      const aiContent = JSON.parse(contentString);

      // 6. Create Draft Reply
      // Use dynamic hostname if available, else default to localhost for safety
      const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:10000';
      const bindUrl = `https://${hostname}/bind-quote?id=${quoteId}`;
      
      const finalEmailBody = aiContent.sales_email_html.replace(
        '[BIND_LINK_PLACEHOLDER]', 
        `<a href="${bindUrl}" style="color: #10B981; font-weight: bold; text-decoration: none;">CLICK HERE TO BIND NOW</a>`
      );

      const rawDraft = makeRawEmail({
        to: from,
        subject: `RE: ${subject} - Proposal Ready`,
        body: finalEmailBody,
        threadId: message.threadId
      });

      await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            threadId: message.threadId,
            raw: rawDraft
          }
        }
      });

      // 7. Mark as Processed (Remove Unread Label)
      await gmail.users.messages.modify({
        userId: 'me',
        id: message.id,
        requestBody: { removeLabelIds: ['UNREAD'] }
      });

      results.push({ id: message.id, status: "Draft Created", quoteId });

    } catch (err) {
      console.error(`❌ Failed message ${message.id}:`, err.message);
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
