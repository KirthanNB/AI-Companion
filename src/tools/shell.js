const { exec } = require('child_process');

async function handleShellAction(action) {
    console.log(`💻 Shell Command: ${action.command} in ${action.cwd || 'default'}`);

    return new Promise((resolve) => {
        exec(action.command, { cwd: action.cwd || undefined }, (error, stdout, stderr) => {
            if (error) {
                console.warn(`Shell Warning: ${error.message}`);
                // Often 'error' means non-zero exit code, but we still want the output
            }
            const output = stdout || stderr || "Command executed (no output)";
            resolve(output.trim());
        });
    });
}

module.exports = { handleShellAction };
