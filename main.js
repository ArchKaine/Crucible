const Bridge = require('./bridge');

// Configuration for LM Studio Local Server
const LLM_ENDPOINT = 'http://127.0.0.1:1234/v1/chat/completions';
const MODEL_NAME = 'local-model'; // LM Studio ignores this and uses whatever is loaded

// The strict JSON schema the AI must adhere to
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

/**
 * Sends the conversation history to LM Studio and parses the response.
 */
async function queryCrucible(promptText) {
    const response = await fetch(LLM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL_NAME,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: promptText }
            ],
            temperature: 0.1 // Kept low to ensure deterministic JSON formatting
        })
    });
    
    const data = await response.json();
    
    // Catch if the server returns an error instead of a completion
    if (data.error) {
        throw new Error(`LM Studio API Error: ${data.error.message}`);
    }

    // Extract the text from the OpenAI-style response format
    return data.choices[0].message.content.trim();
}

/**
 * The core autonomous loop.
 */
async function igniteCrucible(objective) {
    console.log(`[Crucible] Objective Set: ${objective}`);
    
    // We maintain a rolling log of what has happened to provide the AI with short-term memory.
    let executionLog = `Objective: ${objective}\n\n`;

    while (true) {
        console.log(`[Crucible] Pondering next action...`);
        
        try {
            // 1. Get the next instruction from the LLM
            const aiResponse = await queryCrucible(executionLog);
            console.log(`[Crucible] Intention:`, aiResponse);

            const parsedIntention = JSON.parse(aiResponse);

            // Exit condition
            if (parsedIntention.action === 'complete') {
                console.log(`[Crucible] Objective achieved. Shutting down loop.`);
                break;
            }

            // 2. Execute the physical action via the Bridge
            const result = await Bridge.executeAction(aiResponse);
            
            // 3. Log the outcome for the next iteration
            const actionRecord = `Action Taken: ${parsedIntention.action} on ${parsedIntention.target}\nResult: ${result.data}\n\n`;
            executionLog += actionRecord;
            
            if (result.status === 'error') {
                console.warn(`[Crucible] Error encountered. Feeding back to system...`);
            } else {
                console.log(`[Crucible] Action successful.`);
            }

        } catch (err) {
            // If the AI outputs malformed JSON or the API fails, feed the error back
            executionLog += `Action Taken: Invalid JSON generated or API failure.\nResult: System failed to parse. Error: ${err.message}\n\n`;
            console.error(`[Crucible] Loop interruption. Retrying... Error: ${err.message}`);
        }
    }
}

// Kick off the bootstrap process
igniteCrucible("Read indexer.js, understand its logic, and write a new file called ui/dashboard.html that displays 'Crucible Active'.");
