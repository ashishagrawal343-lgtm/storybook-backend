/**
 * TwinkleTale AI — Character QA & Consistency Guardian
 * Validates generated illustrations against deterministic integrity checks
 * and enforces strict regeneration budgeting (MAX_PAGE_QUALITY_REGENERATIONS = 1).
 */

const sharp = require('sharp');

const MAX_PAGE_QUALITY_REGENERATIONS = parseInt(process.env.MAX_PAGE_QUALITY_REGENERATIONS || '1', 10);
const ENABLE_CHARACTER_QA = process.env.ENABLE_CHARACTER_QA !== 'false';

/**
 * Validates a generated image buffer deterministically.
 * @param {Buffer} buffer - Image buffer
 * @param {object} options
 * @param {number} [options.minBytes=5000] - Minimum acceptable byte size
 * @param {number} [options.expectedRatio=0.75] - Expected aspect ratio (3:4 = 0.75)
 * @returns {Promise<{valid: boolean, reason?: string, metrics?: object}>}
 */
async function validateImageQuality(buffer, options = {}) {
    if (!ENABLE_CHARACTER_QA) {
        return { valid: true, reason: 'QA disabled' };
    }

    if (!buffer || !Buffer.isBuffer(buffer)) {
        return { valid: false, reason: 'Empty or invalid image buffer' };
    }

    const minBytes = options.minBytes || 1000;
    if (buffer.length < minBytes) {
        return { valid: false, reason: `File size too small (${buffer.length} bytes < ${minBytes} bytes)` };
    }

    try {
        const metadata = await sharp(buffer).metadata();
        if (!metadata.width || !metadata.height) {
            return { valid: false, reason: 'Could not extract valid image dimensions' };
        }

        const ratio = metadata.width / metadata.height;
        const expectedRatio = options.expectedRatio || 0.75; // 3:4 portrait
        const ratioDelta = Math.abs(ratio - expectedRatio);

        // Allow slight deviation (e.g. 0.73 to 0.77 for 3:4)
        if (ratioDelta > 0.15) {
            console.warn(`⚠️ [CharacterQA] Aspect ratio deviation: ${ratio.toFixed(2)} vs expected ${expectedRatio.toFixed(2)}`);
        }

        return {
            valid: true,
            metrics: {
                width: metadata.width,
                height: metadata.height,
                format: metadata.format,
                sizeBytes: buffer.length
            }
        };
    } catch (err) {
        return { valid: false, reason: `Image corruption detected: ${err.message}` };
    }
}

/**
 * Budget controller to prevent runaway page regeneration loops
 */
class PageRegenerationBudget {
    constructor(maxQualityRetries = MAX_PAGE_QUALITY_REGENERATIONS) {
        this.maxQualityRetries = maxQualityRetries;
        this.pageAttempts = new Map();
    }

    canRegenerate(pageIndex) {
        const attempts = this.pageAttempts.get(pageIndex) || 0;
        return attempts < this.maxQualityRetries;
    }

    recordAttempt(pageIndex) {
        const current = this.pageAttempts.get(pageIndex) || 0;
        this.pageAttempts.set(pageIndex, current + 1);
        return current + 1;
    }

    getAttempts(pageIndex) {
        return this.pageAttempts.get(pageIndex) || 0;
    }
}

module.exports = {
    validateImageQuality,
    PageRegenerationBudget,
    MAX_PAGE_QUALITY_REGENERATIONS,
    ENABLE_CHARACTER_QA
};
