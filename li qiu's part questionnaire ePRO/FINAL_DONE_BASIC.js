// F_surveyController.js
const fs = require('fs');
const path = require('path');
const { evaluateBaseAndConditional } = require('./F_protocolService');
const { generateCustomizedQuestions } = require('./F_aiService');

// ==========================================
// 🔗 LINKING YOUR DYNAMIC PROTOCOL FILE
// ==========================================
const configPath = path.join(__dirname, 'epro_config.json');
let db_protocol = [];
try {
    const rawData = fs.readFileSync(configPath, 'utf8');
    db_protocol = JSON.parse(rawData);
    console.log(`📁 SUCCESS: Loaded ${db_protocol.length} protocol questions.\n`);
} catch (error) {
    console.error("❌ ERROR: Could not find epro_config.json.");
    process.exit(1);
}

// ==========================================
// 🧪 MOCK DATABASE: 2 PATIENTS, 3 DAYS
// ==========================================
const mock_patients = [
    
    {id: "PAT-001", name: "John (Healthy, Low Risk)", 
        medical_history: ["Appendectomy"], past_answers: {}, 
        daily_status: {
            1: { risk: "LOW", vitals: "BP 120/80", chats: ["User: I feel short of breath."] },
            2: { risk: "HIGH", vitals: "BP 122/80", chats: ["User:Hate surveys.ALL GOOD"] },
            3: { risk: "HIGH", vitals: "BP 120/80", chats: ["User: FUCK YOU."] }
        }
    },

    { 
        id: "PAT-002", name: "Sarah (Asthmatic, High Risk)", 
        medical_history: ["Chronic Asthma"], past_answers: {}, 
        daily_status: {
            1: { risk: "HIGH", vitals: "BP 110/70", chats: ["User: I feel short of breath."] },
            2: { risk: "LOW", vitals: "BP 115/72", chats: ["User: Still short of breath. Hate surveys."] },
            3: { risk: "LOW", vitals: "BP 110/70", chats: ["User: Same."] }
        }
    },
    { 
        id: "PAT-003", name: "Robert Fever",
        medical_history: ["Type 2 Diabetes"], past_answers: {}, 
        daily_status: {
            1: { risk: "HIGH", vitals: "BP 135/80", chats: ["User: I woke up shivering in the middle of the night."] },
            2: { risk: "LOW", vitals: "BP 135/80", chats: ["User: I feel really hot now and super weak."] },
            3: { risk: "HIGH", vitals: "BP 135/80", chats: ["User: Same."] }
        }
    }
];

// ==========================================
// 🤖 AUTO-ANSWER SIMULATOR (Now acts like React!)
// ==========================================
function simulatePatientAnswers(surveyConfig) {
    let answersToday = {};
    console.log(`\n      --- 📱 PATIENT PHONE SCREEN ---`);
    
    for (const q of surveyConfig) {
        // ⭐ REAL-TIME LOGIC CHECK (Like React State) ⭐
        if (q.conditional_logic) {
            const { question_id, value } = q.conditional_logic;
            // Check what the patient answered a microsecond ago
            const expected = (value === true || value === "Yes");
            const actual = (answersToday[question_id] === true || answersToday[question_id] === "Yes");
            
            if (expected !== actual) {
                continue; // SKIP! The question stays hidden.
            }
        }

        let displayText = q.question_text || q.question || "Unknown Question"; 
        let textLower = displayText.toLowerCase();
        let ans = false; 
        
        // Force them to say YES to pain/dizziness/breathing so logic triggers
        if (textLower.includes('dizzy') || textLower.includes('breath') || textLower.includes('pain') || textLower.includes('swelling')) {
            ans = true; 
        }
        if (q.question_type === "numeric_scale" || textLower.includes('(0-10)')) {
            ans = 7; 
        }

        // Save the answer to state instantly
        answersToday[q.question_id || q.id] = ans;

        let answerLog = ans === true ? "✅ Yes" : (ans === false ? "❌ No" : `🔢 ${ans}`);
        console.log(`      ❓ [${q.tier}] ${displayText} \x1b[36m[Auto-Answer: ${answerLog}]\x1b[0m`);
    }
    
    console.log(`      -------------------------------`);
    return answersToday;
}

// ==========================================
// 🌉 THE MASTER CONTROLLER 3-DAY LOOP
// ==========================================
async function runFullSimulation() {
    for (const patient of mock_patients) {
        console.log(`\n====================================================================`);
        console.log(` 👤 INITIALIZING PATIENT: ${patient.name}`);
        console.log(`====================================================================`);

        // We use the raw protocol from epro_config.json for Day 1
        let currentSurvey = db_protocol; 

        for (let day = 1; day <= 3; day++) {
            console.log(`\n   ☀️  DAY ${day}: MORNING`);
            
            // 1. Evaluate Logic for the Morning
            const activeQuestions = evaluateBaseAndConditional(currentSurvey, patient.past_answers);
            const visibleQuestions = activeQuestions.filter(q => q.is_active);
            console.log(`      📝 Patient sees ${visibleQuestions.length} questions on their app.`);
            
            // 2. Patient answers the questions
            patient.past_answers = simulatePatientAnswers(visibleQuestions);
            console.log(`      ✅ Patient submitted their diary.`);

            if (day === 3) break; // Stop at Day 3 morning

            // 3. Midnight arrives. AI builds tomorrow's survey.
            console.log(`\n   🌙 MIDNIGHT: Building Day ${day + 1} Survey...`);
            const todayData = patient.daily_status[day];
            console.log(`      📊 Dropout Risk: ${todayData.risk}`);

            // API LIMIT
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            console.log("      ⏳ Pausing for 15s to respect API rate limits...");
            await sleep(15000);

            const aiQuestions = await generateCustomizedQuestions(patient, todayData);
            
            // 4. THE MERGE. We take the original protocol and stick the new AI questions on the end!
            currentSurvey = [...db_protocol, ...aiQuestions];
            console.log(`      ✅ Day ${day + 1} survey compiled successfully.`);
        }
        console.log(`\n   🏁 Trial complete for ${patient.name}.`);
    }
}

// Run the ultimate test!
runFullSimulation();