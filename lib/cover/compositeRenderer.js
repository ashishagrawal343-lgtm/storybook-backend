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
/**
 * Strictly enforces that the child's body, face, head, and hair NEVER cross into the Title Zone (Y < 250).
 * Detects the child's top boundary along the central corridor, and if the child encroaches into
 * the Title Zone, seamlessly adjusts the artwork downward while extending the background atmosphere
 * smoothly to the top.
 */
async function enforceDedicatedHeroZone(baseArtBuffer, width = 600, height = 800) {
    const TARGET_HEAD_Y = 255; // Child hair top must begin at or below Y = 255px

    try {
        const { data, info } = await sharp(baseArtBuffer)
            .raw()
            .toBuffer({ resolveWithObject: true });

        const channels = info.channels;

        // 1. Sample background atmosphere at top center (Y: 10..40, X: 240..360)
        let skyR = 0, skyG = 0, skyB = 0, skyCount = 0;
        for (let y = 10; y <= 40; y++) {
            for (let x = 240; x <= 360; x += 4) {
                const idx = (y * width + x) * channels;
                skyR += data[idx];
                skyG += data[idx + 1];
                skyB += data[idx + 2];
                skyCount++;
            }
        }
        skyR = Math.round(skyR / skyCount);
        skyG = Math.round(skyG / skyCount);
        skyB = Math.round(skyB / skyCount);

        // 2. Scan central corridor (X: 240 to 360) from Y: 80 to TARGET_HEAD_Y for child head/hair top
        let detectedHeadY = TARGET_HEAD_Y;
        for (let y = 80; y < TARGET_HEAD_Y; y++) {
            let rSum = 0, gSum = 0, bSum = 0, count = 0;
            for (let x = 250; x <= 350; x += 4) {
                const idx = (y * width + x) * channels;
                rSum += data[idx];
                gSum += data[idx + 1];
                bSum += data[idx + 2];
                count++;
            }
            const avgR = rSum / count;
            const avgG = gSum / count;
            const avgB = bSum / count;

            // In atmospheric sky, color is either luminous gradient or dark cosmic blue
            // Detect dark hair, textured accessories, or warm skin tones
            const isDarkHair = (avgR < 34 && avgG < 36 && avgB < 46 && (avgR + avgG + avgB) < 100);
            const isSkin = (avgR > avgB + 18 && avgR > 55);
            const distFromSky = Math.sqrt((avgR - skyR)**2 + (avgG - skyG)**2 + (avgB - skyB)**2);

            if (isDarkHair || isSkin || distFromSky > 45) {
                detectedHeadY = y;
                break;
            }
        }

        const shiftY = Math.max(0, TARGET_HEAD_Y - detectedHeadY);
        if (shiftY <= 0) {
            return baseArtBuffer; // Child already comfortably within dedicated hero zone
        }

        console.log(`📐 [DedicatedZoneEnforcer] Detected child head at Y=${detectedHeadY}px (crossing Title Zone limit Y=${TARGET_HEAD_Y}px). Adjusting artwork downward by ${shiftY}px to guarantee dedicated zones.`);

        // 3. Seamlessly extend top atmospheric sky without streaks
        // Extract top slice of sky, vertically flip so bottom matches image top, and apply soft blur
        const topSkySlice = await sharp(baseArtBuffer)
            .extract({ left: 0, top: 0, width, height: Math.min(120, shiftY + 40) })
            .flip()
            .blur(3)
            .resize(width, shiftY, { fit: 'fill' })
            .toBuffer();

        // 4. Crop base to make room at bottom while keeping child's feet grounded
        const croppedBody = await sharp(baseArtBuffer)
            .extract({ left: 0, top: 0, width, height: height - shiftY })
            .toBuffer();

        // 5. Composite adjusted artwork
        const adjustedBuffer = await sharp({
            create: {
                width,
                height,
                channels: 3,
                background: { r: skyR, g: skyG, b: skyB }
            }
        })
        .composite([
            { input: topSkySlice, top: 0, left: 0 },
            { input: croppedBody, top: shiftY, left: 0 }
        ])
        .png()
        .toBuffer();

        return adjustedBuffer;
    } catch (adjustErr) {
        console.warn('⚠️ [DedicatedZoneEnforcer] Notice during zone adjustment:', adjustErr.message);
        return baseArtBuffer;
    }
}

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
        let baseArt = await sharp(artBuffer)
            .resize(width, height, { fit: 'cover', position: 'center' })
            .png({ quality: 100 })
            .toBuffer();

        // 2. Enforce dedicated zones: ensure child body/head/hair NEVER crosses into Title Zone
        baseArt = await enforceDedicatedHeroZone(baseArt, width, height);

        // 3. Generate editorial typography SVG overlay
        const typographySvg = generateCoverTypographySvg({
            childName: options.childName || 'Child',
            bookTitle: options.bookTitle || `${options.childName || 'Child'}'s Adventure`,
            themeMaster: options.themeMaster,
            lang: options.lang || 'en',
            width,
            height
        });

        const overlayBuffer = Buffer.from(typographySvg);

        // 4. Composite typography over the adjusted artwork
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
