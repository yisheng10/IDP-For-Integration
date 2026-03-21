// F_protocolService.js

function evaluateBaseAndConditional(staticConfig, previousAnswers) {
    console.log("   ⚙️ [Protocol Service] Evaluating static protocol logic...");
    
    return staticConfig.map(question => {
        if (!question.conditional_logic) {
            return { ...question, is_active: true };
        }

        const { question_id, operator, value } = question.conditional_logic;
        const patientPastAnswer = previousAnswers[question_id];
        let conditionMet = false;

        if (operator === "equals" && patientPastAnswer !== undefined) {
            const formattedPastAnswer = patientPastAnswer === true || patientPastAnswer === "Yes";
            const expectedValue = value === true || value === "Yes";
            conditionMet = (formattedPastAnswer === expectedValue);
        }

        return { 
            ...question, 
            is_active: conditionMet 
        };
    });
}

// THIS IS THE MOST IMPORTANT LINE! 
module.exports = { evaluateBaseAndConditional };