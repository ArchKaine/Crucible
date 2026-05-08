const Bridge = require('./bridge');

const LLM_ENDPOINT = 'http://127.0.0.1:1234/v1/chat/completions';
const MODEL_NAME = 'qwen2.5-coder-14b';

async function igniteCrucible(objective) {
    console.log(`[Crucible] Objective: ${objective}`);
    let history = [];
    let lastFileContent = ""; 

    // Protocol: The history now stores both ACTIONS and OBSERVATIONS
    while (history.length < 20) {
        const context = `SYSTEM: ${SYSTEM_PROMPT}\nOBJECTIVE: ${objective}\nPROCESS_HISTORY:\n${history.join('\n')}\nNEXT ACTION:`;
        
        try {
            const jsonStr = await queryCrucible(context);
            const intention = JSON.parse(jsonStr);

            if (intention.action === 'complete') {
                console.log("[Crucible] Objective Finalized.");
                break;
            }

            // --- SURGICAL GUARD ---
            if (intention.action === 'writeFile' && lastFileContent && intention.content.length < (lastFileContent.length * 0.5)) {
                const warning = `[GUARD] Data depletion detected on ${intention.target}. Overwrite rejected.`;
                console.warn(warning);
                history.push(`- ACTION: writeFile ${intention.target}\n- OBSERVATION: ERROR - Your output is too short. Re-generate the FULL file.`);
                continue; 
            }

            // --- EXECUTION ---
            const result = await Bridge.executeAction(jsonStr);
            
            if (intention.action === 'readFile') {
                lastFileContent = result.data;
            }

            // --- THE FEEDBACK WELD ---
            // Crucial: The result.data MUST be pushed back into history
            const status = result.status.toUpperCase();
            const observation = result.data ? result.data.substring(0, 2000) : "No data returned.";
            
            history.push(`- ACTION: ${intention.action} ${intention.target} [${status}]`);
            history.push(`- OBSERVATION: ${observation}`);

            if (result.status === 'error') {
                console.error(`[Crucible] Action Failed: ${intention.action}`);
            }

        } catch (err) {
            console.error(`[Crucible] Loop Error: ${err.message}`);
            history.push(`- OBSERVATION: System Error - ${err.message}. Ensure valid JSON output.`);
        }
    }
}