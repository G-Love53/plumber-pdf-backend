// src/quote-processor.js
import { google } from 'googleapis';
import { simpleParser } from 'mailparser';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import OpenAI from 'openai';

/* ---------------- Configuration ---------------- */
// OPENAI_API_KEY must be set in Render environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 

// 1. Initialize OpenAI (The Brain)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ---------------- The Core Logic ---------------- */

/**
 * Processes incoming emails labeled 'CID/CarrierQuotes'.
 * @param {google.auth.JWT} authClient - The authenticated Google JWT client from server.js.
 * @returns {Object} Processing results.
 */
export async function processInbox(authClient) {
  console.log("Starting Quote Ingestion...");
  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const results = [];

  // --- Step 1: Find Unread Quotes ---
  // Query: Unread, Has Attachment, labeled 'CID/CarrierQuotes'
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'label:CID/CarrierQuotes is:unread has:attachment',
    maxResults: 5 // Process a small batch for safety and memory
  });

  const messages = res.data.messages || [];
  if (messages.length === 0) return { status: "No new quotes to process" };

  console.log(`Found ${messages.length} new quote(s).`);

  for (const message of messages) {
    let subject = 'Unknown Subject';
    try {
      // --- DEBUG LINE --- Confirms Auth/Search is working
      console.log(`✅ DEBUG: Found message ID ${message.id}. Attempting to fetch content...`);
      // --- END DEBUG LINE ---
      
      // --- Step 2: Fetch Email Content (Raw is needed for attachments) ---
      const msgData = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'raw' // Get the raw MIME content
      });
      
      // Decode the raw email
      const decodedEmail = Buffer.from(msgData.data.raw, 'base64');
      const parsed = await simpleParser(decodedEmail);
      
      subject = parsed.subject;
      const from = parsed.from.value[0].address;
      
      // --- Step 3: Find PDF Attachment ---
      const pdfAttachment = parsed.attachments.find(att => att.contentType === 'application/pdf');
      
      if (!pdfAttachment) {
        console.log(`Skipping ${subject} - No PDF found.`);
        results.push({ id: message.id, status: "Skipped: No PDF" });
        continue;
      }

      // --- Step 4: Extract Text (The PDF.co replacement) ---
      // pdf-parse reads the buffer directly from memory
      const pdfData = await pdf(pdfAttachment.content);
      const rawText = pdfData.text;

      // Crucial Safety Check (Vision Mode Trigger):
      if (rawText.length < 100) { 
        console.warn(`PDF text is suspiciously short (${rawText.length} chars). May need Vision upgrade.`);
      }

      // --- Step 5: AI Analysis (The Salesman) ---
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert insurance underwriter assistant. 
            Analyze the attached carrier quote text. Your goal is to extract key data and write a persuasive sales email.
            
            OUTPUT JSON:
            {
              "premium": "Number (annual premium)",
              "carrier": "String (e.g., 'Travelers')",
              "subjectivities": ["List strings (items needed to bind e.g., 'Signed Application', 'Prior Loss Run')"],
              "sales_email_html": "String (HTML body for the client. Write a friendly, 'Ready to Bind' email. Be persuasive. Use <br> for breaks.)"
            }
            
            Always include a call to action to click the 'Bind Now' link (which will be added by the caller).`
          },
          { role: "user", content: `Quote Text:\n${rawText}` }
        ],
        response_format: { type: "json_object" }
      });

      const aiContent = JSON.parse(aiResponse.choices[0].message.content);

      // --- Step 6: Create Draft Reply ---
      // Creates a raw MIME message to ensure it replies in the same thread.
      const rawDraft = makeRawEmail({
        to: from,
        subject: `RE: ${subject} - Proposal Ready`,
        body: aiContent.sales_email_html,
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

      // --- Step 7: Mark as Processed (Remove 'Unread') ---
      await gmail.users.messages.modify({
        userId: 'me',
        id: message.id,
        requestBody: { removeLabelIds: ['UNREAD'] }
      });

      results.push({ 
        id: message.id, 
        premium: aiContent.premium, 
        carrier: aiContent.carrier,
        status: "Draft Created" 
      });

    } catch (err) {
      console.error(`❌ Failed to process message ${message.id} (${subject}):`, err.message);
      results.push({ id: message.id, error: `Processing Failed: ${err.message}` });
    }
  }

  return { 
      processedCount: results.filter(r => r.status === 'Draft Created').length, 
      results 
  };
}

/* ---------------- Helper: MIME Builder ---------------- */
function makeRawEmail({ to, subject, body, threadId }) {
  const str = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body
  ].join('\n');
  
  // Base64 URL-safe encoding required by Gmail API
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}
