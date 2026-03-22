// supabase/functions/process-pdf/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'
import pdf from 'npm:pdf-parse/lib/pdf-parse.js'

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    const record = payload.record // The uploaded file info

    // 1. FILTER: Only process PDFs in the 'pdfs' bucket
    if (record.bucket_id !== 'pdfs' || !record.name.endsWith('.pdf')) {
      return new Response('Skipped: Not a protocol PDF', { status: 200 })
    }

    // 2. SETUP: Connect to Supabase & Gemini
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') ?? '')
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" })

    // 3. DOWNLOAD: Get the Protocol PDF
    const { data: fileData, error } = await supabase.storage.from('pdfs').download(record.name)
    if (error) throw error

    // 4. PARSE: Read text from PDF
    const arrayBuffer = await fileData.arrayBuffer()
    const pdfData = await pdf(Buffer.from(arrayBuffer))
    const text = pdfData.text

    // 5. CHUNK & SAVE: Split text and save to RAG Database
    // We split by 800 characters so the AI gets bite-sized context
    const chunks = text.match(/[\s\S]{1,800}/g) || [] 
    
    for (const chunk of chunks) {
      const { embedding } = await model.embedContent(chunk)
      
      await supabase.from('documents').insert({
        content: chunk,
        embedding: embedding.values,
        metadata: { source: record.name } // We tag it so we know which Protocol it belongs to
      })
    }

    return new Response(`Success: Protocol '${record.name}' processed!`, { status: 200 })

  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: 500 })
  }
})