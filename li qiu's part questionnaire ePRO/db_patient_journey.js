// db_patient_journey.js
require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const readline = require('readline');

// --- SETUP ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askUser = (query) => new Promise(resolve => rl.question(query, resolve));

if (!fs.existsSync('epro_config.json')) {
    console.error("❌ Error: 'epro_config.json' not found.");
    process.exit(1);
}
const baseline_config = JSON.parse(fs.readFileSync('epro_config.json', 'utf8'));

// Helper to ask questions and parse Yes/No vs Numbers
async function askQuestion(q, prefix = "") {
    let text = q.question || q.question_text || "Missing question";
    const qId = q.id || q.question_id || text.substring(0, 10);
    const lowerText = text.toLowerCase();

    if (lowerText.includes('rate') && !text.includes('0-10')) text += " (0-10)";
    else if ((lowerText.startsWith('have you') || lowerText.startsWith('did you') || lowerText.startsWith('do you')) && !text.includes('Yes/No')) text += " (Yes/No)";
    
    if (lowerText.includes('if yes') || lowerText.includes('indicate') || lowerText.includes('specify')) {
        if (!lowerText.includes('n/a')) text += " (If no, just type N/A)";
    }

    let ans = await askUser(`❓ ${prefix}${text}: `);
    let finalAnswer;
    const cleanAns = ans.trim().toLowerCase();

    if (cleanAns === 'yes' || cleanAns === 'y') finalAnswer = "Yes";
    else if (cleanAns === 'no' || cleanAns === 'n' || cleanAns.includes('n/a')) finalAnswer = "No";
    else {
        let parsedNum = parseInt(cleanAns);
        finalAnswer = isNaN(parsedNum) ? ans : parsedNum;
    }

    return { id: qId, answer: finalAnswer, text: text };
}

async function runContinuousJourney() {
    console.clear();
    const targetPatient = "PAT-002"; // Sarah Severe

    console.log(`📡 Fetching profile for ${targetPatient} from Supabase...`);
    const { data: patientData, error: patientErr } = await supabase.from('mock_patient_profiles').select('*').eq('patient_id', targetPatient).limit(1); 
    if (patientErr || !patientData || patientData.length === 0) { console.error("❌ Database Error."); rl.close(); return; }
    
    const patientProfile = patientData[0]; 
    console.log(`✅ Loaded Profile: ${patientProfile.name}\n`);

    let current_config = baseline_config; 
    const TOTAL_DAYS = 4; 

    for (let currentDay = 1; currentDay <= TOTAL_DAYS; currentDay++) {
        console.log(`\n==========================================`);
        console.log(`   ☀️  DAY ${currentDay}: MORNING CHECK-IN`);
        console.log(`==========================================`);
        
        let daily_answers = {};
        
        // 1. ASK TODAY'S QUESTIONS
        for (const q of current_config) {
            const tag = (q.tier || "").toUpperCase() === 'BASE' ? '[MANDATORY]' : '[CUSTOMIZED]';
            const result = await askQuestion(q, `${tag} `);
            daily_answers[result.id] = result.answer;
        }

        // ==========================================
        // 💾 NEW: SAVE DIRECTLY TO SUPABASE
        // ==========================================
        console.log(`\n☁️ Uploading Day ${currentDay} Diary to Supabase...`);
        const { error: insertErr } = await supabase
            .from('patient_daily_logs')
            .insert({
                patient_id: targetPatient,
                day_number: currentDay,
                answers: daily_answers
            });

        if (insertErr) {
            console.error("❌ Failed to save diary to DB:", insertErr.message);
        } else {
            console.log(`✅ Day ${currentDay} Diary securely saved in database.`);
        }

        if (currentDay === TOTAL_DAYS) {
            console.log("\n🎉 TRIAL COMPLETE! Check your Supabase database to see the records.");
            break; 
        }

        // ==========================================
        // 🌙 MIDNIGHT: AI FETCHES DATA & GENERATES
        // ==========================================
        console.log(`\n==========================================`);
        console.log(`   🌙 MIDNIGHT: AI GENERATING DAY ${currentDay + 1}...`);
        console.log(`==========================================`);
        
        console.log(`📡 AI is fetching the last 3 days of records from Supabase...`);
        
        // Fetch the 3 most recent days for this specific patient from the DB
        const { data: dbHistory, error: fetchErr } = await supabase
            .from('patient_daily_logs')
            .select('day_number, answers')
            .eq('patient_id', targetPatient)
            .order('day_number', { ascending: false })
            .limit(3);

        // Supabase returns descending (Day 3, Day 2, Day 1). Reverse it for the AI to read chronologically.
        const recentHistory = dbHistory ? dbHistory.reverse() : [];

        const prompt = `
        You are a Continuous Clinical Trial AI Orchestrator. 
        Generate the JSON configuration for the patient's DAY ${currentDay + 1} ePRO questionnaire.

        PATIENT PROFILE:
        - Medical History: ${patientProfile.medical_history.join(", ")}
        - Vitals: BP ${patientProfile.vitals_logged.blood_pressure}, HR ${patientProfile.vitals_logged.heart_rate}, Temp ${patientProfile.vitals_logged.temperature_celsius}°C
        - Chatbot Complaints: ${JSON.stringify(patientProfile.chat_history)}
        - Dropout Risk: ${patientProfile.dropout_risk?.level}

        RECENT PATIENT TREND (LAST 3 DAYS PULLED FROM DB):
        ${JSON.stringify(recentHistory, null, 2)}

        ======================================
        THE IMMUTABLE ORIGINAL PROTOCOL:
        ${JSON.stringify(baseline_config, null, 2)}
        ======================================

        STRICT GENERATION RULES:
        1. THE GATEKEEPER RULE: You MUST ALWAYS include the primary boolean (Yes/No) "BASE" questions from the Original Protocol.
        2. THE PARENT-CHILD RULE (FOR CONDITIONALS): "CONDITIONAL" questions in the protocol are "Children" of the "BASE" questions. If the patient answered "No" to a BASE symptom yesterday, you MUST REMOVE all its related CONDITIONAL questions today. If they answered "Yes" (even if the severity was only 1/10), you MUST KEEP the CONDITIONAL questions to gather clinical details.
        3. SMART BURDEN REDUCTION (FOR SCALES): If a patient's recent rating was < 3, OR if they answered "No" yesterday, REMOVE the 0-10 rating scale today to reduce burden.
        4. RELAPSE CATCHER: If the patient answers "Yes" to a Gatekeeper today, you MUST bring back its associated rating (0-10) scale from the Original Protocol for tomorrow.
        5. AI CUSTOMIZATION: If Chatbot Complaints mention a NEW symptom, invent ONE specific "CONDITIONAL" question for it.
        6. QUESTION FORMAT: Add "(0-10)" for rating, and "(Yes/No)" for boolean.
        
        OUTPUT JSON FORMAT EXACTLY LIKE THIS:
        [ { "id": "...", "tier": "BASE or CONDITIONAL", "question": "..." } ]
        `;

        // 🛡️ THE BULLETPROOF AI RETRY LOOP
        let aiSuccess = false;
        while (!aiSuccess) {
            try {
                const result = await model.generateContent(prompt);
                let responseText = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
                current_config = JSON.parse(responseText); 
                console.log(`✅ Day ${currentDay + 1} Generated Successfully!`);
                aiSuccess = true; // Breaks the loop!
            } catch (e) {
                if (e.message && e.message.includes('429')) {
                    console.log(`   ⏳ AI Rate Limit hit. Google says wait a minute. Pausing for 60s...`);
                    await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds
                    console.log(`   🔄 Retrying Day ${currentDay + 1} Generation...`);
                } else {
                    console.error("❌ AI Error:", e.message);
                    rl.close();
                    return;
                }
            }
        }
    } 

    rl.close();
}

runContinuousJourney();