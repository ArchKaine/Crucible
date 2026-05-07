const { execSync } = require('child_process');
const Explorer = require('./explorer');

const Bridge = {
    async executeAction(aiResponse) {
        try {
            const parsed = JSON.parse(aiResponse);

            switch (parsed.action) {
                case 'readFile':
                    const fileData = await Explorer.readFile(parsed.target);
                    return { status: 'success', data: fileData };

                case 'writeFile':
                    await Explorer.writeFile(parsed.target, parsed.content);
                    return Bridge.validateSyntax(parsed.target);

                case 'runCommand':
                    const output = execSync(parsed.target, { encoding: 'utf8' });
                    return { status: 'success', data: output };

                default:
                    return { status: 'error', data: `Unknown action: ${parsed.action}` };
            }
        } catch (error) {
            return { status: 'error', data: `Execution failed: ${error.message}` };
        }
    },

    validateSyntax(filePath) {
        try {
            if (filePath.endsWith('.js')) {
                execSync(`node --check ${filePath}`);
            }
            return { status: 'success', data: `File written and syntax verified: ${filePath}` };
        } catch (error) {
            return { status: 'error', data: `Syntax error in generated code: ${error.stderr}` };
        }
    }
};

module.exports = Bridge;
