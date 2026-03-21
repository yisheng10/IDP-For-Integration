require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 
const delay = (ms) => new Promise(res => setTimeout(res, ms));




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

// Generate customized questions based on the patient's profile and today's data
async function generateCustomizedQuestions(patientProfile, todayData) {
    console.log("   🧠 [AI Service] Analyzing Patient Risk & Chats...");
    
    const extractedSymptoms = await extractSymptoms(todayData.chats);
    console.log(`      🚨 Extracted Symptoms: [${extractedSymptoms}]`);

    if (extractedSymptoms === "NONE" && todayData.risk === "LOW" && !todayData.vitals.includes("ABNORMAL") && !todayData.vitals.includes("HIGH")) {
        console.log("      ✅ Patient is stable. No customized AI questions needed today.");
        return [];
    }


const prompt = `
    You are a Clinical Trial API. Generate ONLY a JSON array of NEW, "CUSTOMIZED" questions for tomorrow's survey.

    PATIENT PROFILE:
    - Medical History: ${patientProfile.medical_history.join(", ")}
    - Dropout Risk: ${todayData.risk}
    - Vitals Logged Today: ${todayData.vitals}
    - Symptoms Extracted From Chat: ${extractedSymptoms}

    STRICT GENERATION RULES:
    1. DO NOT GENERATE BASE QUESTIONS. You are ONLY generating new "CUSTOMIZED" follow-ups.
    2. THE BURDEN GOVERNOR:
       - If Dropout Risk is "LOW": For EVERY extracted symptom, create a 3-question "CUSTOMIZED" block.
           a) Retrospective severity (0-10).
           b) Gatekeeper: "Are you still experiencing [symptom] today? (Yes/No)".
           c) Current severity (0-10). ⭐ YOU MUST add a "conditional_logic" block to this question, linking it to the ID of question (b) so it only shows if they say Yes!
       - If Dropout Risk is "HIGH": SURVIVAL MODE. Generate strictly ONE Gatekeeper (Yes/No) question for each symptom. ⭐ FATAL ERROR IF YOU GENERATE A (0-10) SCALE FOR HIGH RISK PATIENTS. NO SCALES ALLOWED.
    3. VITALS INVESTIGATOR: If ANY vital is (ABNORMAL) or (HIGH), invent ONE related Gatekeeper (Yes/No) question.
    4. QUESTION FORMAT: Add "(0-10)" or "(Yes/No)". Add "tier": "CUSTOMIZED". Use the exact keys "question_id" and "question_text" (DO NOT use "id" or "question").
    5. NEVER GENERATE DUPLICATE QUESTIONS.
    6. THE MEDICAL HISTORY LENS (CRITICAL FOR TAILORING):
       - You MUST use the patient's Medical History to tailor the text of your questions.
       - If they report shortness of breath and have "Asthma", do not just ask if they are short of breath. Ask if they needed to use their rescue inhaler today.
       - If they report swelling and have "Heart Failure", ask about fluid retention/edema.
       - The question must be deeply personalized to their known condition.

    CRITICAL OUTPUT INSTRUCTION: Output ONLY a valid JSON array. No markdown.
    EXAMPLE: [ { "question_id": "q_ai_1", "tier": "CUSTOMIZED", "question_text": "Are you still experiencing the dizziness today? (Yes/No)" } ]
    `;

    try {
        await delay(4000); // Prevent 429 Quota Error
        const result = await model.generateContent(prompt);
        let responseText = result.response.text().replace(/```json/gi, "").replace(/```/g, "").trim().replace(/,\s*]/g, "]");
        return JSON.parse(responseText); 
    } catch (e) {
        console.error("      ❌ AI Error (Fallback activated):", e.message);
        return []; // Return empty array so the system doesn't crash
    }

}
module.exports = { generateCustomizedQuestions };