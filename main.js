const Bridge = require('./core/bridge');

const LLM_ENDPOINT = 'http://127.0.0.1:11434/api/generate';
const MODEL_NAME = 'llama3';

const SYSTEM_PROMPT = `
You are Crucible, an embedded IDE agent.
You must accomplish the user's objective by exploring the file system, writing code, and running tests.
You may only output valid JSON matching this schema:
{
  "action": "readFile" | "writeFile" | "runCommand" | "complete",
  "target": "file path or command string",
  "content": "code to write (if applicable, else empty)"
}
Do not output any markdown formatting, explanations, or conversational text. Output ONLY the raw JSON object.
`;

async function queryCrucible(promptText) {
    const response = await fetch(LLM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL_NAME,
            system: SYSTEM_PROMPT,
            prompt: promptText,
            stream: false,
            format: 'json'
        })
    });
    
    const data = await response.json();
    return data.response.trim();
}

async function igniteCrucible(objective) {
    console.log(`[Crucible] Objective Set: ${objective}`);
    
    let executionLog = `Objective: ${objective}\n\n`;

    while (true) {
        console.log(`[Crucible] Pondering next action...`);
        
        const aiResponse = await queryCrucible(executionLog);
        console.log(`[Crucible] Intention:`, aiResponse);

        try {
            const parsedIntention = JSON.parse(aiResponse);

            if (parsedIntention.action === 'complete') {
                console.log(`[Crucible] Objective achieved. Shutting down loop.`);
                break;
            }

            const result = await Bridge.executeAction(aiResponse);
            
            const actionRecord = `Action Taken: ${parsedIntention.action} on ${parsedIntention.target}\nResult: ${result.data}\n\n`;
            executionLog += actionRecord;
            
            if (result.status === 'error') {
                console.warn(`[Crucible] Error encountered. Feeding back to system...`);
            } else {
                console.log(`[Crucible] Action successful.`);
            }

        } catch (err) {
            executionLog += `Action Taken: Invalid JSON generated.\nResult: System failed to parse. Error: ${err.message}\n\n`;
            console.error(`[Crucible] JSON parse failure. Retrying...`);
        }
    }
}

igniteCrucible("Read core/indexer.js, understand its logic, and write a new file called ui/dashboard.html that displays 'Crucible Active'.");
