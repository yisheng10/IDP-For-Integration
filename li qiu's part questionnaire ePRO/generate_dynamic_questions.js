// generate_dynamic_questions.js
require('dotenv').config();
process.env.GRPC_DNS_RESOLVER = 'native';

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI, TaskType } = require('@google/generative-ai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 💡 TIP: You can use 1.5-flash here too if 2.5-flash-lite hits quota limits!
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' }); 
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

async function generateSmartQuestionnaire() {
    console.log("\n🏥 STARTING ANALYSIS (Using 2.5-Flash-Lite)...\n");

    try {
        const query = "Primary endpoints, patient diary, and safety signals";
        console.log("🔍 Fetching relevant protocol data from Supabase...");
        
        const embResult = await embeddingModel.embedContent({
            content: { parts: [{ text: query }] },
            taskType: TaskType.RETRIEVAL_QUERY
        });

        const { data: matches, error } = await supabase.rpc("match_protocol_chunks", {
            query_embedding: embResult.embedding.values,
            match_threshold: 0.45, 
            match_count: 4 
        });

        if (error) throw error;
        const context = matches.map(m => m.content).join("\n\n");

        console.log("🧠 AI is drafting the customized questionnaire...");

        // ==========================================
        // 🏗️ THE ENGINEERING BLUEPRINT PROMPT
        // ==========================================
        const prompt = `
        You are a Clinical Trial Protocol Architect. Based on the provided context, generate a strict JSON array of daily ePRO (Patient Reported Outcome) questions.

        PROTOCOL CONTEXT:
        ${context}

        STRICT JSON SCHEMA AND TIER DEFINITIONS:
        You must output an array of question objects with the exact following keys: "question_id", "question_text", "question_type" ("boolean", "numeric_scale", or "text"), "tier", and "conditional_logic".

        1. THE "BASE" TIER (Mandatory & Gatekeepers):
           - Apply "tier": "BASE" to all mandatory primary endpoint questions.
           - CRITICAL: Apply "tier": "BASE" to ALL initial "Gatekeeper" questions (e.g., initial Yes/No questions like "Have you experienced skin issues today?").
           - BASE questions must always have "conditional_logic": null.

        2. THE "CONDITIONAL" TIER (Follow-ups):
           - Apply "tier": "CONDITIONAL" ONLY to follow-up questions (e.g., "If yes, please rate the severity 0-10").
           - CRITICAL: EVERY "CONDITIONAL" question MUST contain a "conditional_logic" object linking it to its BASE trigger. NEVER output "conditional_logic": null for a CONDITIONAL tier question.

        EXAMPLE CONDITIONAL LOGIC STRUCTURE:
        "conditional_logic": {
            "question_id": "ePRO_001", // The ID of the BASE gatekeeper question
            "operator": "equals",
            "value": true
        }

        OUTPUT RULES:
        - Output ONLY valid JSON array. No markdown formatting, no code blocks, no introductory text.
        `;

        const result = await model.generateContent(prompt);
        
        // 🛡️ Bulletproof JSON Cleaning
        let text = result.response.text();
        text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        
        const jsonData = JSON.parse(text);
        fs.writeFileSync('epro_config.json', JSON.stringify(jsonData, null, 4));
        
        console.log(`✅ Success! Generated ${jsonData.length} beautifully formatted questions.`);
        console.log("💾 Saved to 'epro_config.json'");

    } catch (e) {
        console.error("❌ Process Error:", e.message);
    }
}

generateSmartQuestionnaire();