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
