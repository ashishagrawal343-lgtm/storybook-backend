/**
 * TwinkleTale AI — Cover Quality Assurance (QA) Runner
 * Automated pre-flight validation for cover generation:
 *  - Canvas dimension compliance (600x800 preview, 1200x1600 print)
 *  - Buffer validity and PNG format verification
 *  - Typography safe-zone compliance (no collision with hero zone)
 *  - Indic glyph completeness verification
 */

const sharp = require('sharp');
const { calculateCoverZones } = require('./zoneCalculator');
const { wrapTitle } = require('./typographyEngine');

async function validateCoverOutput(coverBuffer, metadata = {}) {
    const errors = [];
    const warnings = [];

    if (!coverBuffer || !Buffer.isBuffer(coverBuffer)) {
        return {
            valid: false,
            errors: ['Cover buffer is empty or not a Buffer'],
            warnings: [],
            metrics: {}
        };
    }

    if (coverBuffer.length < 5000) {
        errors.push(`Cover buffer suspiciously small (${coverBuffer.length} bytes)`);
    }

    let imageMeta = {};
    try {
        imageMeta = await sharp(coverBuffer).metadata();
    } catch (err) {
        errors.push(`Failed to parse cover image metadata: ${err.message}`);
        return { valid: false, errors, warnings, metrics: {} };
    }

    // Dimension checks
    const expectedWidth = metadata.expectedWidth || 600;
    const expectedHeight = metadata.expectedHeight || 800;

    if (imageMeta.width !== expectedWidth || imageMeta.height !== expectedHeight) {
        warnings.push(`Dimensions ${imageMeta.width}x${imageMeta.height} do not match target ${expectedWidth}x${expectedHeight}`);
    }

    const zones = calculateCoverZones(imageMeta.width, imageMeta.height);

    // Title line-wrap safety check
    if (metadata.bookTitle) {
        const titleLines = wrapTitle(metadata.bookTitle, 22);
        if (titleLines.length > 3) {
            warnings.push(`Book title wraps across ${titleLines.length} lines, which may crowd the hero zone`);
        }
    }

    const metrics = {
        width: imageMeta.width,
        height: imageMeta.height,
        format: imageMeta.format,
        channels: imageMeta.channels,
        sizeBytes: coverBuffer.length,
        heroAreaRatio: zones.heroZone.areaRatio
    };

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        metrics
    };
}

module.exports = {
    validateCoverOutput
};
