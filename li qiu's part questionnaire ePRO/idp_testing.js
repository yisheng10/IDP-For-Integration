// idp_testing.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const axios = require('axios');

// ⭐ HELPER: The sleep function to prevent Rate Limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🚨 PDF URL
const PDF_URL = "https://ocrisfulapcyudgkowry.supabase.co/storage/v1/object/sign/test/Prot_001.pdf?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV80MDJlNDBjNy02YTc3LTQ2N2UtODQ1Zi0xODcyMGRjMzM0MjMiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJ0ZXN0L1Byb3RfMDAxLnBkZiIsImlhdCI6MTc3MjQyOTMzOCwiZXhwIjoxODAzOTY1MzM4fQ.t8RN4nvAtiFEd81TZuD6stDRy0WikiV4bEy6Th5LZUk"; 

// --- SETUP ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

async function ingestProtocol() {
    console.log("⬇️  Downloading PDF from Signed URL...");
    
    try {
        // 1. Download the PDF
        const response = await axios.get(PDF_URL, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        console.log("✅ Download Successful!");

        // 2. Extract Text
        console.log("📖 Reading PDF text...");
        const data = await pdf(buffer);
        const text = data.text;

        // 3. Chunk the Text
        const rawChunks = text.split(/\n\s*\n/);
        const chunks = rawChunks.filter(c => c.length > 50); 

        console.log(`🧩 Created ${chunks.length} text chunks. Uploading to DB...`);
        console.log("⏳ Speed strictly regulated to avoid Rate Limits (This will take ~8 minutes)...");

        // 4. Embed and Upload Loop (WITH RATE LIMIT PROTECTIONS)
        for (let i = 0; i < chunks.length; i++) {
            const chunkContent = chunks[i];

            try {
                // A. Generate Vector
                const embeddingResult = await model.embedContent(chunkContent);
                const vector = embeddingResult.embedding.values;

                // B. Insert into Supabase
                const { error } = await supabase
                    .from('protocol_chunks')
                    .insert({
                        content: chunkContent,
                        embedding: vector,
                        protocol_id: "new_protocol_v1" // Tagging it just in case
                    });

                if (error) {
                    console.error(`   ❌ Error saving chunk ${i}:`, error.message);
                } else {
                    if (i % 5 === 0 || i === chunks.length - 1) console.log(`   ✅ Saved chunk ${i}/${chunks.length}`);
                }

                // ⭐ THE MATH FIX: Wait 4.5 seconds to stay strictly under the 15 RPM limit
                await sleep(4500);

            } catch (apiError) {
                // 🛡️ THE AUTO-RETRY FIX FOR 429 ERRORS
                if (apiError.message && apiError.message.includes('429')) {
                    console.log(`   ⚠️ Hit Rate Limit on chunk ${i}. Pausing for 15 seconds...`);
                    await sleep(15000); // Pause to let quota reset
                    i--; // Go back 1 step to retry this exact chunk!
                } else {
                    console.error(`   ❌ Unknown API Error on chunk ${i}:`, apiError.message);
                }
            }
        }

        console.log("🎉 Ingestion Complete! Your database is fully loaded.");

    } catch (err) {
        console.error("❌ CRITICAL ERROR:", err.message);
    }
}

ingestProtocol();