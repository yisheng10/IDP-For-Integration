// test_chat_pipeline.js
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 

// ==========================================
// 🧪 1. THE MOCK DATA
// ==========================================
const tiny_baseline = [
    { id: "q_pain_gate", tier: "BASE", question: "Have you experienced any joint pain today?" }
];

const mockProfile = { medical_history: ["Rheumatoid Arthritis"] };

// 💬 THE MOCK CHAT DATABASE (What the patient typed each day)
const daily_chat_logs = {
    1: [
        "User: Hello chatbot.",
        "User: Can I eat grapefruit with my meds?",
        "User: dying today." // Hidden symptom!
    ],
    2: [
        "User: I'm feeling okay.",
        "User: stomach weird since lunch." // New symptom!
    ],
    3: [
        "User: Np." // No symptoms!
    ]
};

// ==========================================
// 🧠 2. MICROSERVICE 1: THE SYMPTOM EXTRACTOR
// ==========================================
async function extractSymptomsFromChat(chatLogs) {
    if (!chatLogs || chatLogs.length === 0) return "NONE";

    const prompt = `
    You are a Medical NLP Extractor. Read the following chatbot logs from a patient today.
    Extract ANY new medical symptoms or complaints they mentioned.
    
    CHAT LOGS:
    ${JSON.stringify(chatLogs)}
    
    RULES:
    1. If they mention a symptom, return ONLY a comma-separated list of the symptoms (e.g., "Headache, Nausea").
    2. If there are no medical symptoms mentioned, return the exact word "NONE".
    3. Do not include conversational text or pleasantries.
    `;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        console.error("Extractor Error:", e);
        return "NONE";
    }
}

// ==========================================
// 🚀 3. THE PIPELINE LOOP
// ==========================================
async function runPipelineTest() {
    console.clear();
    console.log("🚀 STARTING CHAT EXTRACTION PIPELINE TEST\n");

    let current_config = tiny_baseline; 

    for (let currentDay = 1; currentDay <= 3; currentDay++) {
        console.log(`\n==========================================`);
        console.log(`   ☀️  DAY ${currentDay}: MORNING SURVEY`);
        console.log(`==========================================`);
        
        // --- 1. THE MORNING SURVEY ---
        for (const q of current_config) {
            const tag = (q.tier || "").toUpperCase() === 'BASE' ? '[MANDATORY]' : '[CUSTOMIZED]';
            console.log(`   ❓ ${tag} ${q.question} \x1b[36m[Auto-Answer: Yes]\x1b[0m`);
        }

        console.log(`\n   🌙 MIDNIGHT HAS ARRIVED...`);
        
        // --- 2. FETCH TODAY'S CHAT LOGS ---
        const todaysChats = daily_chat_logs[currentDay] || [];
        console.log(`   📥 Fetching ${todaysChats.length} raw chat messages from today...`);

        // --- 3. MICROSERVICE A: EXTRACT SYMPTOMS ---
        console.log(`   🧠 AI Extractor analyzing raw text...`);
        const extractedSymptoms = await extractSymptomsFromChat(todaysChats);
        
        if (extractedSymptoms === "NONE") {
            console.log(`   ✅ Extractor Result: \x1b[32mPatient is fine. No new symptoms found.\x1b[0m`);
        } else {
            console.log(`   🚨 Extractor Result: \x1b[31mFound Symptoms -> [${extractedSymptoms}]\x1b[0m`);
        }

        // --- 4. MICROSERVICE B: GENERATE TOMORROW'S SURVEY ---
        console.log(`   ⚙️  AI Orchestrator building Day ${currentDay + 1} survey...`);
        
        const prompt = `
        You are a Clinical Trial API. You do not speak English. You ONLY output raw JSON arrays.
        Generate the JSON configuration for DAY ${currentDay + 1}.

        PATIENT PROFILE:
        - Medical History: ${mockProfile.medical_history.join(", ")}
        
        NEW SYMPTOMS EXTRACTED FROM TODAY'S CHAT:
        ${extractedSymptoms}

        ======================================
        THE IMMUTABLE ORIGINAL PROTOCOL:
        ${JSON.stringify(tiny_baseline, null, 2)}
        ======================================

        STRICT GENERATION RULES:
        1. THE PROTOCOL ANCHOR: You MUST ALWAYS include every "BASE" question exactly as written.
        2. THE RETROSPECTIVE CATCH-UP (CRITICAL): For EVERY symptom listed in "NEW SYMPTOMS EXTRACTED", you MUST create a strict 3-question "Follow-Up Block" labeled as "CUSTOMIZED" tier. Use unique, simple IDs for each (e.g., "q_retro", "q_gate", "q_current"):
           - Question 1 (Retrospective): "You mentioned experiencing [symptom] to the chatbot yesterday. At its worst, how would you rate its severity?" (0-10)
           - Question 2 (Gatekeeper): "Are you still experiencing the [symptom] today?" (Yes/No)
           - Question 3 (Current Status): "Please rate your current [symptom] severity." (0-10)
        3. QUESTION FORMAT: Ensure the exact formatting of "(0-10)" for rating, and "(Yes/No)" for boolean.
        
        CRITICAL OUTPUT INSTRUCTION: Output ONLY a valid JSON array. No markdown, no introductory text, no code block backticks.

        OUTPUT JSON FORMAT EXACTLY LIKE THIS:
        [ 
          { "id": "q1", "tier": "BASE", "question": "Have you experienced any joint pain today?" },
          { "id": "q2", "tier": "CUSTOMIZED", "question": "Are you still experiencing the headache today? (Yes/No)" }
        ]
        `;

        try {
            const result = await model.generateContent(prompt);
            let responseText = result.response.text();
            
            // 🛡️ JSON CLEANING ARMOR: Remove ALL markdown formatting completely
            responseText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
            
            current_config = JSON.parse(responseText); 
            console.log(`   ✅ Day ${currentDay + 1} Survey Generated!`);
        } catch (e) {
            console.error("❌ AI Error (JSON Parsing Failed):", e.message);
            console.error("RAW AI OUTPUT WAS:\n", result.response?.text()); // This prints exactly what broke it!
            return;
        }
    } 
    console.log("\n🎉 PIPELINE TEST COMPLETE!");
}

runPipelineTest();

//customized chatbot history question generation logic is done