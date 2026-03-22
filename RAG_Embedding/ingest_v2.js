// ingest_v2.js
require('dotenv').config();
const fs = require('fs');
// We use the 'legacy' build which works best in Node.js environments
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- CONFIGURATION ---
const SUPABASE_URL = process.env.SUPABASE_URL; 
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const PDF_PATH = "./CTCAE.pdf"; 

// ADJUST THIS IF YOUR PAGE NUMBERS ARE WRONG
// Example: If the PDF's "Page 1" is actually the 3rd sheet (after cover/TOC), set this to -2.
const PAGE_OFFSET = 0; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

async function ingest() {
  try {
    console.log("🧹 Clearing old data...");
    await supabase.from('documents').delete().neq('id', 0);

    console.log("📖 Loading PDF...");
    const dataBuffer = new Uint8Array(fs.readFileSync(PDF_PATH));
    
    // Load the PDF Document
    const loadingTask = pdfjsLib.getDocument(dataBuffer);
    const doc = await loadingTask.promise;

    console.log(`📄 PDF Loaded. Total Sheets: ${doc.numPages}`);

    let totalChunks = 0;

    // Strict Loop: Page 1 to End
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      
      // Join all text items on the page with a space
      const text = textContent.items.map((item) => item.str).join(' ');

      // Clean up whitespace
      const cleanText = text.replace(/\s+/g, ' ').trim();

      if (cleanText.length < 50) {
        console.log(`⚠️  Skipping Page ${i} (Empty/Image only)`);
        continue;
      }

      // Calculate the "Human Readable" page number
      const printedPageNum = i + PAGE_OFFSET;

      // Chunk the text
      const chunks = splitText(cleanText, 800);

      for (const chunk of chunks) {
        // Generate Embedding
        const result = await model.embedContent(chunk);
        let embedding = result.embedding.values;

        // Force 768 Dimensions (Gemini Compatibility)
        if (embedding.length > 768) {
          embedding = embedding.slice(0, 768);
        }

        // Save to Supabase
        const { error } = await supabase.from('documents').insert({
          content: chunk,
          embedding: embedding,
          metadata: { 
            source: 'CTCAE_v6.pdf', 
            page: printedPageNum // <--- Saves the calculated number
          }
        });

        if (error) console.error(`❌ Insert Error Page ${i}:`, error.message);
        else totalChunks++;

        // Small pause to prevent rate limits
        await new Promise(r => setTimeout(r, 50));
      }
      
      // Progress log every 5 pages
      if (i % 5 === 0) console.log(`✅ Processed up to Sheet ${i} (Page ${printedPageNum})`);
    }

    console.log(`🎉 Done! Uploaded ${totalChunks} chunks.`);

  } catch (e) {
    console.error("CRITICAL ERROR:", e);
  }
}

function splitText(text, chunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

ingest();