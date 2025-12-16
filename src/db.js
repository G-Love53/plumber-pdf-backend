// src/db.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
// CRITICAL: Use the Service Role Key for server-side security
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("⚠️ Supabase credentials missing. Database features will not work.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Function to save the initial AI-analyzed quote data
export async function saveQuoteToDb(data) {
  const { error } = await supabase
    .from('quotes')
    .insert([data]);
    
  if (error) {
    console.error("❌ DB Save Failed:", error);
    throw error;
  }
  console.log(`✅ Quote ${data.quote_id} saved to Supabase.`);
}
/**
 * Uploads educational materials to the Knowledge Hub
 * @param {string} carrierName - e.g., 'Travelers'
 * @param {string} segment - e.g., 'Plumber'
 * @param {string} type - 'Marketing' | 'Definitions' | 'Step-by-Step Guides' | 'Forms' | 'Training'
 * @param {string} title - The display name of the PDF
 * @param {Buffer} fileBuffer - The PDF file data
 */
export async function uploadCarrierResource(carrierName, segment, type, title, fileBuffer) {
  const fileName = `${title.replace(/\s+/g, '_').toLowerCase()}.pdf`;
  const path = `carrier-resources/${carrierName}/${segment}/${type}/${fileName}`;

  // 1. Upload to the secure storage bucket
  const { data: upload, error: uploadErr } = await supabase.storage
    .from('cid-docs')
    .upload(path, fileBuffer, { 
      contentType: 'application/pdf',
      upsert: true // Allows robots to update documents if they change
    });

  if (uploadErr) throw uploadErr;

  // 2. Index in the database table so the App can find it
  const { error: dbErr } = await supabase
    .from('carrier_resources')
    .insert([{
      carrier_name: carrierName,
      segment: segment,
      resource_type: type,
      title: title,
      file_path: path
    }]);

  if (dbErr) throw dbErr;
}
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export { saveQuoteToDb, uploadCarrierResource };
