// test_medical_lens.js
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 

const patients = [
    { name: "John (Healthy Baseline)", history: "Appendectomy in 2015" },
    { name: "Sarah (Asthmatic)", history: "Chronic Asthma" },
    { name: "Robert (Cardiac)", history: "Congestive Heart Failure" }
];

const sharedChatbotComplaint = "User: I've been feeling really short of breath this afternoon.";

async function runLensTest() {
    console.clear();
    console.log("🧬 STARTING MEDICAL HISTORY LENS TEST\n");
    console.log(`💬 ALL 3 PATIENTS TRIGGER: "${sharedChatbotComplaint}"\n`);

    for (const patient of patients) {
        console.log(`==========================================`);
        console.log(` 👤 PATIENT: ${patient.name}`);
        console.log(` 🏥 MEDICAL HISTORY: ${patient.history}`);
        console.log(`==========================================`);
        
        const prompt = `
        You are a Clinical Trial API. You ONLY output raw JSON arrays.
        The patient complained to the chatbot today: "${sharedChatbotComplaint}"

        PATIENT MEDICAL HISTORY: ${patient.history}

        STRICT GENERATION RULES:
        1. Invent exactly ONE "CUSTOMIZED" follow-up question regarding their shortness of breath.
        2. THE MEDICAL HISTORY LENS (CRITICAL): You MUST tailor this question to their specific Medical History. 
           - If their history is irrelevant to breathing, ask a standard severity/diagnostic question.
           - If they have a specific condition (like Asthma or Heart Failure), ask a hyper-specific medical safety question related to how that condition causes shortness of breath (e.g., inhaler use, edema/swelling, etc.).
        3. QUESTION FORMAT: Add "(0-10)" for rating, or "(Yes/No)" for boolean.

        CRITICAL OUTPUT INSTRUCTION: Output ONLY a valid JSON array. No markdown, no introductory text.

        OUTPUT JSON FORMAT EXACTLY LIKE THIS:
        [ { "id": "q_lens", "tier": "CUSTOMIZED", "question": "..." } ]
        `;

        try {
            console.log(`   ⚙️  AI generating personalized question...`);
            const result = await model.generateContent(prompt);
            let responseText = result.response.text().replace(/```json/gi, "").replace(/```/g, "").trim();
            
            const generated_config = JSON.parse(responseText); 
            console.log(`   ✅ \x1b[32mAI Output:\x1b[0m ${generated_config[0].question}\n`);
            
        } catch (e) {
            console.error("❌ AI Error:", e.message);
        }
    }
}

runLensTest();