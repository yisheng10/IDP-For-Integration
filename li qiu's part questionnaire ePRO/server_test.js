// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors()); 
app.use(express.json());

// --- SETUP SUPABASE & AI ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' }); // Using your fast model!

// Load Baseline Protocol
const configPath = path.join(__dirname, 'epro_config.json');
const baseline_config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// ==========================================
// ⏱️ SIMULATION STATE ENGINE
// ==========================================
let currentDay = 1;
let activePatient = null; 
let currentConfigCache = []; // Holds the active survey for the day

// 📞 ENDPOINT 1: RESET SIMULATION & FETCH PATIENT FROM SUPABASE
app.post('/api/start-simulation', async (req, res) => {
    const { patientId } = req.body;
    
    console.log(`\n=========================================`);
    console.log(` 📡 Fetching Profile ${patientId} from Supabase...`);
    
    // 1. Fetch the seeded patient from Supabase!
    const { data, error } = await supabase
        .from('mock_patient_profiles')
        .select('*')
        .eq('patient_id', patientId)
        .single();

    if (error || !data) {
        console.error("❌ Database Error:", error);
        return res.status(500).json({ error: "Patient not found in Supabase" });
    }

    // 2. Set the global state
    activePatient = data;
    currentDay = 1;
    currentConfigCache = baseline_config; // Day 1 always uses the baseline!
    
    console.log(` ✅ SUCCESS: Loaded ${activePatient.name}`);
    console.log(`=========================================\n`);
    
    res.json({ success: true, day: currentDay, patient: activePatient.name });
});

// 📞 ENDPOINT 2: GET TODAY'S SURVEY
app.get('/api/daily-survey', async (req, res) => {
    if (!activePatient) return res.status(400).json({ error: "No patient loaded. Please start simulation." });
    if (currentDay > 4) return res.json({ trial_complete: true });

    console.log(`\n☀️  React requested DAY ${currentDay} survey...`);

    // If it's Day 1, we just send the baseline. If it's Day > 1, the AI already generated it at Midnight!
    res.json({ 
        day: currentDay, 
        patientName: activePatient.name,
        questions: currentConfigCache
    }); 
});

// 📞 ENDPOINT 3: SUBMIT SURVEY (SAVES TO SUPABASE & RUNS MIDNIGHT AI)
app.post('/api/submit-survey', async (req, res) => {
    const patientAnswers = req.body.answers;
    
    console.log(`\n☁️ Uploading Day ${currentDay} Diary to Supabase...`);
    
    try {
        // 1. 💾 SAVE TO SUPABASE (Just like your journey script!)
        const { error: insertErr } = await supabase
            .from('patient_daily_logs')
            .insert({
                patient_id: activePatient.patient_id,
                day_number: currentDay,
                answers: patientAnswers
            });

        if (insertErr) throw insertErr;
        console.log(`✅ Day ${currentDay} securely saved in database.`);

        // 2. Advance the Time Machine
        currentDay++;

        // 3. 🌙 MIDNIGHT RUN: AI FETCHES DATA & GENERATES TOMORROW'S CONFIG
        // 3. 🌙 MIDNIGHT RUN: AI FETCHES DATA & GENERATES CUSTOM QUESTIONS ONLY
        if (currentDay <= 4) {
            console.log(`\n🌙 MIDNIGHT: AI GENERATING DAY ${currentDay} CUSTOM QUESTIONS...`);
            
            // 🧠 THE NEW, BULLETPROOF PROMPT
            const prompt = `
            You are a Clinical AI Assistant. Your ONLY job is to read the patient's Chatbot Complaints and generate 0 to 2 "CUSTOMIZED" follow-up questions.

            PATIENT PROFILE:
            - Medical History: ${activePatient.medical_history.join(", ")}
            - Chatbot Complaints: ${JSON.stringify(activePatient.chat_history)}

           STRICT GENERATION RULES:
            1. OUTPUT FORMAT: Output ONLY a valid JSON array. Do not output conversational text.
            2. THE BURDEN GOVERNOR & TRIAGE (CRITICAL): Adjust based on the Patient's "Dropout Risk" and "Chatbot Complaints".
               - If Dropout Risk is "LOW": For EVERY symptom mentioned in the chats, create a strict 3-question "CUSTOMIZED" Block:
                   a) Retrospective: "You mentioned experiencing [symptom] yesterday. At its worst, how would you rate its severity?" (0-10)
                   b) Gatekeeper: "Are you still experiencing the [symptom] today?" (Yes/No)
                   c) Current Status: "Please rate your current [symptom] severity." (0-10)
               - If Dropout Risk is "HIGH": SURVIVAL MODE. Prevent survey fatigue.
                   a) IGNORE minor complaints (e.g., mild headache, fatigue). Generate NO questions for them.
                   b) For SEVERE symptoms (e.g., severe pain, breathing issues), generate strictly ONE Gatekeeper (Yes/No) question. ABSOLUTELY NO 0-10 rating scales are allowed.
            3. VITALS INVESTIGATOR: If ANY vital is marked (ABNORMAL) or (HIGH) compared to standard baselines, invent ONE specific "CUSTOMIZED" Gatekeeper (Yes/No) question about it.
            4. THE MEDICAL HISTORY LENS: Tailor your questions to their specific Medical History (e.g., if they have Asthma and report breathing issues, ask about inhaler usage).
            5. ABORT CONDITION: If there are no concerning complaints in the chat and vitals are normal, output an empty array: []
            6. FORMATTING: Add "(0-10)" to the text for rating scales, and "(Yes/No)" to the text for booleans. Ensure every generated question has '"tier": "CUSTOMIZED"'.

        CRITICAL OUTPUT INSTRUCTION: Output ONLY a valid JSON array. No markdown, no introductory text, no code blocks. Use double quotes for keys and values. Escape any internal quotes.

            OUTPUT JSON FORMAT EXACTLY LIKE THIS:
            [ 
              { 
                "question_id": "ai_cust_1", 
                "tier": "CUSTOMIZED", 
                "question_text": "...", 
                "question_type": "boolean" 
              } 
            ]
            `;

            try {
                // Call Gemini
                const result = await model.generateContent(prompt);
                let responseText = result.response.text().replace(/```json/gi, "").replace(/```/g, "").trim();
                
                let aiCustomQuestions = JSON.parse(responseText);
                
                // 🔗 THE MASTER MERGE: Immutable Protocol + AI Custom Questions
                currentConfigCache = [...baseline_config, ...aiCustomQuestions]; 
                
                console.log(`✅ AI generated ${aiCustomQuestions.length} custom questions for Day ${currentDay}!`);
            } catch (aiError) {
                console.error("⚠️ AI Generation Failed, falling back to safe baseline:", aiError.message);
                currentConfigCache = baseline_config; // Failsafe: if AI crashes, patient still gets the core survey!
            }
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Process Failed:", err);
        res.status(500).json({ error: "Failed to process day" });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 API Server running on http://localhost:${PORT}`));