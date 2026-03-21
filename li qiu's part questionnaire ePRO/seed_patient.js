// seed_patients.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const mockPatients = [
    {
        patient_id: "PAT-001",
        name: "Alex Baseline",
        dob: "1995-04-12", 
        sex: "Male",
        medical_history: ["None"],
        vitals_logged: { blood_pressure: "120/80", heart_rate: 72, temperature_celsius: 36.8 },
        chat_history: [
            "User: I took my medication at 8 AM.",
            "User: I feel totally fine today, no issues."
        ],
        // NEW: Yi Sheng's Model Data
        dropout_risk: {
            level: "LOW",
            reason: "Highly compliant. Logs in daily and reports no severe side effects."
        }
    },
    {
        patient_id: "PAT-002",
        name: "Sarah Severe",
        dob: "1982-11-05", 
        sex: "Female",
        medical_history: ["Hypertension", "Crohn's Disease"],
        vitals_logged: { blood_pressure: "145/95", heart_rate: 88, temperature_celsius: 37.5 },
        chat_history: [
            "User: I've been going to the bathroom all morning.",
            "User: My stomach is cramping really badly right now, it's easily an 8 out of 10 pain."
        ],
        // NEW: Yi Sheng's Model Data
        dropout_risk: {
            level: "HIGH",
            reason: "Severe side effects escalating. High risk of abandoning the trial due to pain."
        }
    },
    {
        patient_id: "PAT-003",
        name: "Marcus Tired",
        dob: "1975-08-22", 
        sex: "Male",
        medical_history: ["Mild Asthma", "Anxiety"],
        vitals_logged: { blood_pressure: "130/85", heart_rate: 98, temperature_celsius: 37.0 },
        chat_history: [
            "User: I couldn't sleep at all last night.",
            "User: I feel completely exhausted today, my chest feels a little tight."
        ],
        // NEW: Yi Sheng's Model Data
        dropout_risk: {
            level: "MEDIUM",
            reason: "Survey Fatigue. Missed yesterday's diary entry and reporting high exhaustion."
        }
    },
    {
        patient_id: "PAT-004",
        name: "Chloe Mild",
        dob: "2001-02-15", 
        sex: "Female",
        medical_history: ["Irritable Bowel Syndrome (IBS)"],
        vitals_logged: { blood_pressure: "115/75", heart_rate: 68, temperature_celsius: 36.9 },
        chat_history: [
            "User: I felt a little bit of nausea right after taking the pill.",
            "User: It passed after 20 minutes though, no stomach pain."
        ],
        // NEW: Yi Sheng's Model Data
        dropout_risk: {
            level: "LOW",
            reason: "Side effects are mild and transient. Good adherence."
        }
    },
    {
        patient_id: "PAT-005",
        name: "Robert Fever",
        dob: "1960-09-30", 
        sex: "Male",
        medical_history: ["Type 2 Diabetes"],
        vitals_logged: { blood_pressure: "135/80", heart_rate: 105, temperature_celsius: 38.6 },
        chat_history: [
            "User: I woke up shivering in the middle of the night.",
            "User: I feel really hot now and super weak."
        ],
        // NEW: Yi Sheng's Model Data
        dropout_risk: {
            level: "HIGH",
            reason: "Medical Escalation. Potential Adverse Event (Fever/Tachycardia) requiring immediate intervention."
        }
    }
];

async function seedDatabase() {
    console.log("🌱 Starting Database Seeding...\n");

    const TABLE_NAME = 'mock_patient_profiles'; // Using the table name from your error log

    for (let i = 0; i < mockPatients.length; i++) {
        const patient = mockPatients[i];
        
        console.log(`📤 Uploading Data for: ${patient.name} (${patient.patient_id})...`);
        
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .insert([patient]);

        if (error) {
            console.error(`❌ Error uploading ${patient.patient_id}:`, error.message);
        } else {
            console.log(`✅ Success: ${patient.patient_id} logged.`);
        }
    }

    console.log("\n🎉 Seeding Complete! Your Supabase is now loaded with test data.");
}

seedDatabase();