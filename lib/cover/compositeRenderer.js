/**
 * TwinkleTale AI — Modern Editorial Cover Composite Renderer
 * Composites full-bleed AI artwork with editorial SVG typography.
 * Completely replaces the legacy medallion circle with a modern, full-bleed
 * picture-book cover where the character is naturally integrated into the scene.
 */

const sharp = require('sharp');
const { generateCoverTypographySvg } = require('./typographyEngine');
const { calculateCoverZones } = require('./zoneCalculator');

/**
 * Composites cover artwork buffer with editorial typography overlay.
 *
 * @param {Buffer} artBuffer - Raw image buffer of the AI-generated full-bleed cover scene
 * @param {Object} options - Cover typography and theme configuration
 * @param {string} options.childName - Protagonist's name
 * @param {string} options.bookTitle - Complete book title
 * @param {Object} options.themeMaster - Resolved theme master constitution
 * @param {string} [options.lang='en'] - Story language
 * @param {number} [options.width=600] - Target canvas width
 * @param {number} [options.height=800] - Target canvas height
 * @returns {Promise<Buffer>} Pristine composited PNG buffer
 */
async function renderEditorialCoverComposite(artBuffer, options = {}) {
    const width = options.width || 600;
    const height = options.height || 800;

    if (!artBuffer || !Buffer.isBuffer(artBuffer)) {
        throw new Error('[CompositeRenderer] Invalid artwork buffer provided to renderEditorialCoverComposite');
    }

    try {
        // 1. Process base artwork to exact canvas dimensions
        const baseArt = await sharp(artBuffer)
            .resize(width, height, { fit: 'cover', position: 'center' })
            .png({ quality: 100 })
            .toBuffer();

        // 2. Generate editorial typography SVG overlay
        const typographySvg = generateCoverTypographySvg({
            childName: options.childName || 'Child',
            bookTitle: options.bookTitle || `${options.childName || 'Child'}'s Adventure`,
            themeMaster: options.themeMaster,
            lang: options.lang || 'en',
            width,
            height
        });

        const overlayBuffer = Buffer.from(typographySvg);

        // 3. Composite typography over the artwork
        const finalComposite = await sharp(baseArt)
            .composite([
                {
                    input: overlayBuffer,
                    top: 0,
                    left: 0,
                    blend: 'over'
                }
            ])
            .png({ compressionLevel: 8 })
            .toBuffer();

        return finalComposite;
    } catch (err) {
        console.error('❌ [CompositeRenderer] Error compositing cover:', err.message);
        throw err;
    }
}

module.exports = {
    renderEditorialCoverComposite
};
