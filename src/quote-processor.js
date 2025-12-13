// src/quote-processor.js (UPDATED)

import { GoogleGenAI } from '@google/genai';
// Import only the required database function
import { saveQuoteToDb, supabase } from './db.js'; // <-- Updated Import

// --- Initialization ---

// Gemini AI setup
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
const model = "gemini-2.5-flash";

// --- Core Functions ---

// The dedicated saveQuoteData function from the previous step is replaced by the imported saveQuoteToDb

// Function to process the quote (AI analysis and data saving)
export async function processQuote(clientData) {
    const { quoteId, userInput, segment, clientEmail } = clientData; // Use the expanded fields from the new schema
    let aiAnalysis = null;
    let dbResult = { success: false };

    // ... (AI Analysis remains the same) ...

    try {
        // 1. AI Analysis (using Gemini)
        // ... (existing AI prompt and parsing logic) ...
        const prompt = `Analyze the following insurance application text and extract key policy details in a JSON object...`;
        const response = await ai.models.generateContent({
            // ... config ...
        });
        const aiAnalysis = JSON.parse(response.text.trim());

        // 2. Prepare Data for Supabase
        const dataToSave = {
            quote_id: quoteId,
            segment: segment,
            client_email: clientEmail,
            premium: aiAnalysis.premium,
            carrier: aiAnalysis.carrier, // Assuming carrier comes from AI or a lookup
            subjectivities: aiAnalysis, // Store the full analyzed JSON here
            status: 'draft' 
        };

        // 3. Save Data to Supabase (using the secure function)
        await saveQuoteToDb(dataToSave);
        dbResult.success = true;

        // 4. Return combined result to the client
        return {
            quoteId: quoteId,
            quoteDetails: aiAnalysis,
            dbSaveSuccess: dbResult.success,
            message: "Quote analyzed and data saved for binding."
        };

    } catch (error) {
        console.error('Error during quote processing:', error.message);
        return {
            quoteId: quoteId,
            quoteDetails: null,
            dbSaveSuccess: false,
            message: `Processing failed. Error: ${error.message}`
        };
    }
}


// --- Updated Bind Function (Need to ensure it uses the imported 'supabase') ---
export async function bindQuote(quoteId) {
    console.log(`Attempting to bind quote with ID: ${quoteId}`);
    try {
        const { data, error } = await supabase // <-- Uses the imported 'supabase'
            .from('quotes')
            .update({ status: 'bound', bound_at: new Date() }) 
            .eq('quote_id', quoteId) // Use quote_id for the lookup
            .select();

        // ... (rest of the binding logic) ...
        if (error || !data || data.length === 0) {
            return { success: false, error: error ? error.message : `Quote ID ${quoteId} not found.` };
        }

        return { success: true, quote: data[0] };

    } catch (e) {
        console.error('Unexpected Binding Operation Error:', e);
        return { success: false, error: 'Binding operation failed' };
    }
}
