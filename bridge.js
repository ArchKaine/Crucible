const {
    execSync
} = require('child_process');
const fs = require('fs');
const path = require('path');
const forgeFS = require('./forge_fs');

const Bridge = {
    async executeAction(aiResponse) {
        try {
            const parsed = JSON.parse(aiResponse);

            switch (parsed.action) {
                case 'readFile':
                    const fileData = forgeFS.readFile(parsed.target);
                    return {
                        status: 'success',
                        data: fileData
                    };

                    case 'writeFile':
                        forgeFS.writeFile(parsed.target, parsed.content);
                        return this.validateSyntax(parsed.target);

                        case 'grepSearch':
                            const searchResults = await forgeFS.searchFiles(parsed.target, process.cwd());
                            return {
                                status: 'success',
                                data: JSON.stringify(searchResults.slice(0, 10))
                            };

                            case 'shadowTest':
                                return this.runShadowVerification(parsed.target, parsed.content);

                                case 'runCommand':
                                    const output = execSync(parsed.target, {
                                        encoding: 'utf8', timeout: 30000
                                    });
                                    return {
                                        status: 'success',
                                        data: output
                                    };

                                    case 'complete':
                                        return {
                                            status: 'success',
                                            data: "Objective Finalized."
                                        };

                                        default:
                                            return {
                                                status: 'error',
                                                data: `Unknown action: ${parsed.action}`
                                            };
                                        }
                                } catch (error) {
                                    return {
                                        status: 'error',
                                        data: `Execution failed: ${error.message}`
                                };
                        }
                },

                runShadowVerification(targetPath, content) {
                    const shadowDir = path.join('/tmp', 'crucible_shadow');
                    if (!fs.existsSync(shadowDir)) fs.mkdirSync(shadowDir, {
                        recursive: true
                });

                const fileName = path.basename(targetPath);
                const tempPath = path.join(shadowDir, fileName);

                try {
                    fs.writeFileSync(tempPath, content);
                    if (fileName.endsWith('.js')) {
                        execSync(`node --check ${tempPath}`, {
                            stdio: 'pipe'
                    });
            }
            return {
                status: 'success',
                data: `Shadow verification passed for ${fileName}`
            };
        } catch (error) {
            return {
                status: 'error',
                data: `Shadow verification failed: ${error.message}`
            };
        }
    },

    validateSyntax(filePath) {
        try {
            if (filePath.endsWith('.js')) {
                execSync(`node --check ${filePath}`, {
                    stdio: 'pipe'
                });
            }
            return {
                status: 'success',
                data: `File synchronized and verified: ${filePath}`
            };
        } catch (error) {
            return {
                status: 'error',
                data: `Syntax error in primary buffer: ${error.message}`
            };
        }
    }
};

module.exports = Bridge;