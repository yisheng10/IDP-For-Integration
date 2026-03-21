import React, { useState, useEffect } from 'react';

export default function DynamicQuestionnaire() {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitted, setIsSubmitted] = useState(false);
  
  // Simulator State
  const [currentDay, setCurrentDay] = useState(1);
  const [patientName, setPatientName] = useState("");
  const [trialComplete, setTrialComplete] = useState(false);

  // 1. FETCH THE SURVEY
  const loadSurvey = () => {
    setIsLoading(true);
    fetch('http://localhost:3000/api/daily-survey')
      .then(res => res.json())
      .then(data => {
        if (data.trial_complete) {
          setTrialComplete(true);
        } else {
          setQuestions(data.questions || []); // 👈 ADD THE || [] HERE
          setCurrentDay(data.day);
          setPatientName(data.patientName);
        }
        setIsLoading(false);
      })
      .catch(err => { console.error(err); setIsLoading(false); });
  };

  useEffect(() => { 
    startSimulation("PAT-001"); // Auto-loads Alex from Supabase on startup!
  }, []);

  // 2. SIMULATOR CONTROLS (Change Patient & Reset)
  const startSimulation = async (patientId) => {
    setIsLoading(true);
    await fetch('http://localhost:3000/api/start-simulation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId })
    });
    setTrialComplete(false);
    setIsSubmitted(false);
    setAnswers({});
    loadSurvey();
  };

  // 3. SAVE PATIENT ANSWERS
  const handleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  // 4. SUBMIT DAY
  const handleSubmit = async () => {
    setIsLoading(true); 
    try {
      await fetch('http://localhost:3000/api/submit-survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      });
      setIsSubmitted(true);
      setIsLoading(false);
    } catch (err) {
      console.error(err);
      setIsLoading(false);
    }
  };

  // UI RENDERING =====================================
  
  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="text-xl font-bold text-blue-600 animate-pulse">⚙️ AI is building the survey...</div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-6 bg-gray-50 min-h-screen">
      
      {/* SIMULATOR CONTROL PANEL */}
      <div className="mb-8 p-4 bg-slate-800 rounded-xl shadow-lg flex justify-between items-center text-white">
        <div>
          <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">Active Patient</div>
          <div className="font-bold">{patientName}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => startSimulation("PAT-001")} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors">Alex</button>
          <button onClick={() => startSimulation("PAT-002")} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors">Sarah</button>
          <button onClick={() => startSimulation("PAT-003")} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors">Marcus</button>
          <button onClick={() => startSimulation("PAT-004")} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors">Chloe</button>
          <button onClick={() => startSimulation("PAT-005")} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors">Robert</button>
        </div>
      </div>

      <h1 className="text-3xl font-bold mb-2 text-blue-900">Day {currentDay} Check-In</h1>
      <p className="text-gray-500 mb-6">Please answer the following questions based on how you feel right now.</p>

      {trialComplete ? (
        <div className="bg-white border-2 border-blue-500 text-blue-800 p-10 rounded-xl text-center shadow-sm">
          <h2 className="text-3xl font-bold mb-4">🏁 Trial Complete!</h2>
          <p>This patient has successfully finished their 3-day clinical trial journey.</p>
        </div>
      ) : isSubmitted ? (
        <div className="mt-8 bg-green-100 border-2 border-green-500 text-green-800 p-6 rounded-xl text-center shadow-sm transition-all duration-500">
          <h2 className="text-2xl font-bold mb-2">🎉 Diary Submitted!</h2>
          <p className="font-medium mb-6">Thank you. Your clinical team has received your update.</p>
          <button 
            onClick={() => {
              setIsSubmitted(false);
              setAnswers({}); 
              loadSurvey(); // Fetches tomorrow's questions!
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow transition-colors"
          >
            Advance to Day {currentDay + 1} ☀️
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {questions.map((q) => {
              // REACT LOGIC CHECK
              if (q.conditional_logic) {
                const { question_id, value } = q.conditional_logic;
                const expected = (value === true || value === "Yes");
                const actual = (answers[question_id] === true || answers[question_id] === "Yes");
                if (expected !== actual) return null; 
              }

              const qId = q.question_id || q.id;
              const qText = q.question_text || q.question || "Unknown";

              return (
                <div key={qId} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 transition-all duration-300">
                  <h3 className="font-medium text-gray-800 mb-4">
                    {q.tier === 'CUSTOMIZED' && <span className="text-xs font-bold text-purple-600 bg-purple-100 px-2 py-1 rounded mr-2">CUSTOM</span>}
                    {qText.replace('(Yes/No)', '').replace('(0-10)', '')}
                  </h3>

                  {(q.question_type === 'boolean' || qText.toLowerCase().includes('(yes/no)')) && (
                    <div className="flex gap-4">
                      <button onClick={() => handleAnswer(qId, true)} className={`flex-1 py-3 rounded-lg font-medium transition-colors ${answers[qId] === true ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Yes</button>
                      <button onClick={() => handleAnswer(qId, false)} className={`flex-1 py-3 rounded-lg font-medium transition-colors ${answers[qId] === false ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>No</button>
                    </div>
                  )}

                  {(q.question_type === 'numeric_scale' || qText.toLowerCase().includes('(0-10)')) && (
                    <div className="px-2">
                       <input type="range" min="0" max="10" value={answers[qId] || 0} onChange={(e) => handleAnswer(qId, parseInt(e.target.value))} className="w-full cursor-pointer accent-blue-600"/>
                       <div className="text-center mt-2 font-bold text-blue-600 text-lg">{answers[qId] !== undefined ? answers[qId] : "-"}</div>
                    </div>
                  )}

                  {/* RENDER TEXT INPUT (Descriptions/Elaborations) */}
                  {(q.question_type === 'text' || qText.toLowerCase().includes('describe') || qText.toLowerCase().includes('elaborate')) && (
                    <div className="mt-2">
                      <textarea 
                        rows="3"
                        placeholder="Type your answer here..."
                        value={answers[qId] || ""}
                        onChange={(e) => handleAnswer(qId, e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none text-gray-700"
                      />
                    </div>
                  )}

                </div>
              );
            })}
          </div>

          <button onClick={handleSubmit} className="w-full mt-8 bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-xl shadow-lg transition-transform active:scale-95">
            Submit Day {currentDay} Diary
          </button>
        </>
      )}
    </div>
  );
}