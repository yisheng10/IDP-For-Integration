// test_ultimate_architecture.js
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 

// ==========================================
// 🧪 1. THE MOCK DATA
// ==========================================
const tiny_baseline = [
    { id: "q_base_1", tier: "BASE", question: "Have you experienced any joint pain today?" }
];

const mockProfile = { medical_history: ["Asthma"] };

// Dynamic Daily Data that changes as the trial progresses!
const daily_patient_status = {
    1: { 
        risk: "LOW", 
        vitals: "BP 120/80 (Normal), HR 72 (Normal), Temp 36.8C (Normal)",
        chats: [
            "User: Hi chatbot.",
            "User: I have a mild headache today, and also some shortness of breath."
        ]
    },
    2: { 
        risk: "HIGH", // 🚨 SARAH IS FRUSTRATED AND MIGHT QUIT!
        vitals: "BP 125/82 (Normal), HR 125 (ABNORMAL - HIGH), Temp 37.0C (Normal)", // 🚨 VITAL SPIKE!
        chats: [
            "User: My nose is a bit runny, but I also just had some severe chest pain." 
        ]
    }
};

// ==========================================
// 🧠 2. MICROSERVICE A: EXTRACTOR
// ==========================================
async function extractSymptoms(chatLogs) {
    if (!chatLogs || chatLogs.length === 0) return "NONE";
    const prompt = `Extract ANY medical symptoms from these logs. Return ONLY a comma-separated list. If none, return "NONE".\nLOGS: ${JSON.stringify(chatLogs)}`;
    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) { return "NONE"; }
}

// ==========================================
// 🤖 3. AUTO-ANSWER SIMULATOR
// ==========================================
function simulateAnswer(q, currentDay) {
    let text = q.question.toLowerCase();
    let ans = "No"; // Default healthy answer

    // If the AI asks the Gatekeeper about shortness of breath or chest pain, she says Yes.
    if (text.includes('shortness of breath') || text.includes('chest pain') || text.includes('heart')) {
        ans = "Yes";
    }

    if (text.includes('rate') || text.includes('0-10')) ans = 5;

    console.log(`   ❓ ${q.tier === 'BASE' ? '[MANDATORY]' : '[CUSTOMIZED]'} ${q.question} \x1b[36m[Auto-Answer: ${ans}]\x1b[0m`);
    return ans;
}

// ==========================================
// 🚀 4. THE 3-DAY AUTOMATED PIPELINE
// ==========================================
async function runUltimateTest() {
    console.clear();
    console.log("🚀 STARTING ULTIMATE ARCHITECTURE TEST (Automated)\n");

    let current_config = tiny_baseline; 

    for (let currentDay = 1; currentDay <= 3; currentDay++) {
        console.log(`\n==========================================`);
        console.log(`   ☀️  DAY ${currentDay}: MORNING SURVEY`);
        console.log(`==========================================`);
        
        let lastGatekeeperAnswer = "Yes"; 

        // --- FRONTEND REAL-TIME SKIP LOGIC ---
        for (const q of current_config) {
            const text = (q.question || "").toLowerCase();
            const isFollowUp = text.includes('rate') || text.includes('current severity');

            if (isFollowUp && lastGatekeeperAnswer === "No") {
                console.log(`   ⏭️  \x1b[33m[SKIPPED BY FRONTEND]\x1b[0m ${q.question}`);
                continue; 
            }

            const ans = simulateAnswer(q, currentDay);
            if (ans === "Yes" || ans === "No") lastGatekeeperAnswer = ans;
        }

        if (currentDay === 3) {
            console.log("\n🎉 ULTIMATE PIPELINE TEST COMPLETE!");
            break; 
        }

        console.log(`\n   🌙 MIDNIGHT HAS ARRIVED...`);
        const todayData = daily_patient_status[currentDay];
        
        console.log(`   📊 Patient Dropout Risk: \x1b[35m${todayData.risk}\x1b[0m`);
        console.log(`   📥 Analyzing Vitals and Chatbot Logs...`);
        
        const extractedSymptoms = await extractSymptoms(todayData.chats);
        console.log(`   🚨 Symptoms Extracted: [${extractedSymptoms}]`);

        // --- MICROSERVICE B: THE MASTER ORCHESTRATOR ---
        console.log(`   ⚙️  AI Orchestrator building Day ${currentDay + 1} payload...`);
        
        const prompt = `
        You are a Clinical Trial API. You ONLY output raw JSON arrays.
        Generate the JSON configuration for DAY ${currentDay + 1}.

        PATIENT PROFILE:
        - Medical History: ${mockProfile.medical_history.join(", ")}
        - Dropout Risk: ${todayData.risk}
        - Vitals Logged Today: ${todayData.vitals}
        - Symptoms Extracted From Chat: ${extractedSymptoms}

        ======================================
        THE IMMUTABLE ORIGINAL PROTOCOL:
        ${JSON.stringify(tiny_baseline, null, 2)}
        ======================================

        STRICT GENERATION RULES:
        1. THE PROTOCOL ANCHOR: You MUST ALWAYS include every "BASE" question exactly as written.
        
        2. THE BURDEN GOVERNOR & TRIAGE (CRITICAL): You must adjust your generated questions based on the Patient's Dropout Risk.
           - If Dropout Risk is "LOW": For EVERY symptom in "Symptoms Extracted", create a strict 3-question "CUSTOMIZED" Block:
               a) Retrospective: "You mentioned experiencing [symptom] yesterday. At its worst, how would you rate its severity?" (0-10)
               b) Gatekeeper: "Are you still experiencing the [symptom] today?" (Yes/No)
               c) Current Status: "Please rate your current [symptom] severity." (0-10)
           - If Dropout Risk is "HIGH": SURVIVAL MODE. Prevent survey fatigue.
               a) IGNORE minor complaints (e.g., mild headache, runny nose, fatigue). Generate NO questions for them.
               b) For SEVERE symptoms (e.g., chest pain, breathing issues), generate strictly ONE Gatekeeper (Yes/No) question.
               c) ABSOLUTELY NO 0-10 rating scales are allowed.

        3. VITALS INVESTIGATOR: If ANY vital is marked (ABNORMAL) or (HIGH), invent ONE specific "CUSTOMIZED" Gatekeeper (Yes/No) question. (If Dropout Risk is HIGH, do not ask for a rating scale).
        
        4. THE MEDICAL HISTORY LENS: NEVER generate questions just because a condition exists in the Medical History. ONLY use Medical History to tailor the wording of the Chat/Vitals questions. (e.g., if they have Asthma and report breathing issues, ask about inhaler usage).

        5. QUESTION FORMAT: Add "(0-10)" for rating, and "(Yes/No)" for boolean. Add "tier": "BASE" or "CUSTOMIZED".
        
        CRITICAL OUTPUT INSTRUCTION: Output ONLY a valid JSON array. No markdown, no introductory text, no code blocks. Use double quotes for keys and values. Escape any internal quotes.

        EXAMPLE JSON STRUCTURE (Follow this exactly!):
        [
          { "id": "q1", "tier": "BASE", "question": "Have you experienced any joint pain today?" },
          { "id": "q_cust_1", "tier": "CUSTOMIZED", "question": "Are you still experiencing the headache today? (Yes/No)" }
        ]
        `;

        try {
            const result = await model.generateContent(prompt);
            let responseText = result.response.text();
            
            // 🛡️ JSON CLEANING ARMOR: Brutally strip out any possible Markdown that breaks JSON.parse
            responseText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
            
            // Sometimes the AI adds a trailing comma at the end of the array, which breaks standard JSON. This regex fixes it.
            responseText = responseText.replace(/,\s*]/g, "]");

            current_config = JSON.parse(responseText); 
            console.log(`   ✅ Day ${currentDay + 1} Survey Successfully Generated!`);
        } catch (e) {
            console.error("❌ AI Error (JSON Parsing Failed):", e.message);
            console.log("\n--- RAW AI OUTPUT (For Debugging) ---");
            console.log(result?.response?.text());
            console.log("-------------------------------------\n");
            return;
        }
    } 
}

runUltimateTest();