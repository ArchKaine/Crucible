const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
// Note: Ensure forge_fs.js is the source for filesystem operations
const forgeFS = require('./forge_fs'); 

const Bridge = {
    async executeAction(aiResponse) {
        try {
            const parsed = JSON.parse(aiResponse);

            switch (parsed.action) {
                case 'readFile':
                    const fileData = forgeFS.readFile(parsed.target);
                    return { status: 'success', data: fileData };

                case 'writeFile':
                    // Immediate write to primary storage - strictly for verified logic
                    forgeFS.writeFile(parsed.target, parsed.content);
                    return this.validateSyntax(parsed.target);

                case 'grepSearch':
                    // Surgical query of Lore or Codebase
                    const searchResults = await forgeFS.searchFiles(parsed.target, process.cwd());
                    return { status: 'success', data: JSON.stringify(searchResults.slice(0, 10)) };

                case 'shadowTest':
                    // Isolated verification in /tmp before committing to the Forge
                    return this.runShadowVerification(parsed.target, parsed.content);

                case 'runCommand':
                    const output = execSync(parsed.target, { encoding: 'utf8', timeout: 30000 });
                    return { status: 'success', data: output };

                case 'complete':
                    return { status: 'success', data: "Objective Finalized." };

                default:
                    return { status: 'error', data: `Unknown action: ${parsed.action}` };
            }
        } catch (error) {
            return { status: 'error', data: `Execution failed: ${error.message}` };
        }
    },

    /**
     * Executes syntax verification in a temporary shadow directory.
     * Prevents the 14B model from breaking the active codebase.
     */
    runShadowVerification(targetPath, content) {
        const shadowDir = path.join('/tmp', 'crucible_shadow');
        if (!fs.existsSync(shadowDir)) fs.mkdirSync(shadowDir, { recursive: true });

        const fileName = path.basename(targetPath);
        const tempPath = path.join(shadowDir, fileName);
        
        try {
            fs.writeFileSync(tempPath, content);
            if (fileName.endsWith('.js')) {
                execSync(`node --check ${tempPath}`, { stdio: 'pipe' });
            }
            return { status: 'success', data: `Shadow verification passed for ${fileName}` };
        } catch (error) {
            return { status: 'error', data: `Shadow verification failed: ${error.message}` };
        }
    },

    validateSyntax(filePath) {
        try {
            if (filePath.endsWith('.js')) {
                execSync(`node --check ${filePath}`, { stdio: 'pipe' });
            }
            return { status: 'success', data: `File synchronized and verified: ${filePath}` };
        } catch (error) {
            return { status: 'error', data: `Syntax error in primary buffer: ${error.message}` };
        }
    }
};

module.exports = Bridge;