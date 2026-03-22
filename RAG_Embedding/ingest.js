require('dotenv').config();
const fs = require('fs');
const pdf = require('pdf-extraction'); // <--- Using the library you requested
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- CONFIGURATION ---
const SUPABASE_URL = "https://fygkqituefwldmglijvy.supabase.co"; 
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Z2txaXR1ZWZ3bGRtZ2xpanZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MDEyNjQsImV4cCI6MjA4MjA3NzI2NH0.1WvXWCFA--ZAhL9bBwVl5D-bshQHc5z4F0BngqSeRIA"; 
const GEMINI_API_KEY = "AIzaSyAaE3iXBNfrxDt2SVYv9Zxn3lE5NaGo6Nc"; 
const PDF_PATH = "./CTCAE.pdf"; 

// ADJUSTMENT: Set this if your PDF's "Page 1" is actually the 3rd sheet (e.g. Cover + TOC)
const PAGE_OFFSET = 0; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

async function ingest() {
  try {
    console.log("start");
    
    // 1. Clear old data to avoid duplicates
    const { error: deleteError } = await supabase.from('documents').delete().neq('id', 0);
    if (deleteError) console.warn("Warning clearing table:", deleteError.message);
    else console.log("🧹 Old data cleared.");

    // 2. Read PDF with Custom Page Rendering
    console.log("📖 Reading PDF Page-by-Page...");
    const dataBuffer = fs.readFileSync(PDF_PATH);

    const options = {
      // This function runs for EVERY page as it is parsed.
      pagerender: function (pageData) {
        return pageData.getTextContent().then(function (textContent) {
          let lastY, text = '';
          for (let item of textContent.items) {
            if (lastY == item.transform[5] || !lastY) {
              text += item.str;
            } else {
              text += '\n' + item.str;
            }
            lastY = item.transform[5];
          }
          // INJECT DELIMITER + PAGE INDEX (0-based, so +1)
          return `|||PAGE_${pageData.pageIndex + 1}|||` + text;
        });
      }
    };

    const data = await pdf(dataBuffer, options);
    const fullText = data.text;

    // 3. Split by the delimiter we added
    // This gives us an array where each item is one page
    const rawPages = fullText.split('|||PAGE_');
    console.log(`📄 Found ${rawPages.length - 1} pages.`);

    let totalChunks = 0;

    // 4. Loop through pages (skip index 0 which is empty before the first delimiter)
    for (let i = 1; i < rawPages.length; i++) {
      const pageContent = rawPages[i];
      
      // Find where the page number ends and text begins
      const splitIndex = pageContent.indexOf('|||');
      const rawPageNum = parseInt(pageContent.substring(0, splitIndex));
      
      // Apply offset (to match printed numbers)
      const actualPageNum = rawPageNum + PAGE_OFFSET;
      
      // Extract the text content
      const text = pageContent.substring(splitIndex + 3); 

      if (!text || text.length < 50) continue; 

      // 5. Chunk the text
      const chunks = splitText(text, 800);

      for (const chunk of chunks) {
        // Generate Embedding
        const result = await model.embedContent(chunk);
        let embedding = result.embedding.values;

        // FIX: Force 768 Dimensions (Slice off extra precision if needed)
        if (embedding.length > 768) {
          embedding = embedding.slice(0, 768);
        }

        // 6. Insert into Supabase with Metadata
        const { error } = await supabase.from('documents').insert({
          content: chunk,
          embedding: embedding,
          metadata: { 
            source: 'CTCAE_v6.pdf', 
            page: actualPageNum // <--- Saving the Correct Page Number
          }
        });

        if (error) {
            console.error(`❌ Insert Error Page ${actualPageNum}:`, error.message);
        } else {
            totalChunks++;
        }
        
        // Rate limit pause for Gemini Free Tier
        await new Promise(r => setTimeout(r, 50));
      }
      if (i % 5 === 0) console.log(`✅ Processed Page ${actualPageNum}`);
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