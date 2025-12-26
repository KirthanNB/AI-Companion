const { desktopCapturer } = require('electron');

/**
 * Captures the primary screen and returns a base64 encoded image or Buffer.
 * @param {Object} options 
 * @param {boolean} options.base64 - If true, returns base64 string. Default true.
 * @param {number} options.width - Thumbnail width. Default 1920.
 * @param {number} options.height - Thumbnail height. Default 1080.
 * @returns {Promise<string|Buffer>}
 */
async function captureScreen({ base64 = true, width = 1920, height = 1080 } = {}) {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width, height }
        });

        const primarySource = sources[0]; // Assuming primary screen
        if (!primarySource) throw new Error("No screen source found.");

        if (base64) {
            return primarySource.thumbnail.toPNG().toString('base64');
        } else {
            return primarySource.thumbnail.toPNG();
        }
    } catch (error) {
        console.error("Screen capture failed:", error);
        throw error;
    }
}

module.exports = { captureScreen };
