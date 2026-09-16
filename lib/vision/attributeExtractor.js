/**
 * TwinkleTale AI — Photo Visual & Cultural Attribute Extractor
 * Analyzes uploaded reference photos to detect and preserve:
 *  1. Cultural Headwear: turban, patka, dastar, rumal, hijab, etc.
 *  2. Eyewear: spectacles, glasses, frames
 *  3. Skin Tone & Complexion
 *  4. Hair style and texture
 *
 * Provides:
 *  - High-speed vision analysis via lightweight Vision LLM (google/gemini-2.5-flash)
 *  - In-memory photo hash caching to eliminate redundant vision API calls
 *  - 4.5-second timeout race fallback so generation never hangs
 *  - Client override merging (manual parent feature tags take precedence)
 */

const crypto = require('crypto');
const Replicate = require('replicate');

const replicateToken = process.env.REPLICATE_API_TOKEN;
const replicate = replicateToken ? new Replicate({ auth: replicateToken }) : null;

// In-memory cache keyed by SHA-256 hash of photo payload
const attributeCache = new Map();

/**
 * Normalizes and validates the extracted attribute object
 */
function normalizeAttributes(raw = {}, clientOverrides = {}) {
    const overrides = clientOverrides && typeof clientOverrides === 'object' ? clientOverrides : {};

    // 1. Headwear normalization
    let hasHeadwear = overrides.hasHeadwear !== undefined
        ? !!overrides.hasHeadwear
        : !!raw.hasHeadwear;

    let headwearType = String(overrides.headwearType || raw.headwearType || 'none').toLowerCase().trim();
    if (['turban', 'patka', 'dastar', 'pagri', 'rumal', 'hijab', 'cap', 'hat'].some(t => headwearType.includes(t))) {
        hasHeadwear = true;
    } else if (headwearType === 'none' || !headwearType) {
        hasHeadwear = false;
        headwearType = 'none';
    }

    let headwearColor = String(overrides.headwearColor || raw.headwearColor || '').trim();
    let headwearDescription = String(overrides.headwearDescription || raw.headwearDescription || '').trim();

    if (hasHeadwear && !headwearDescription) {
        const colorPrefix = headwearColor ? `${headwearColor} ` : '';
        headwearDescription = `traditional ${colorPrefix}${headwearType === 'none' ? 'turban' : headwearType}`.trim();
    }

    // 2. Glasses / Spectacles normalization
    let hasGlasses = overrides.hasGlasses !== undefined
        ? !!overrides.hasGlasses
        : !!raw.hasGlasses;

    let glassesDescription = String(overrides.glassesDescription || raw.glassesDescription || '').trim();
    if (hasGlasses && !glassesDescription) {
        glassesDescription = 'charming spectacles';
    }

    // 3. Skin tone normalization
    let skinTone = String(overrides.skinTone || raw.skinTone || 'warm golden brown').trim();
    if (!skinTone) skinTone = 'warm golden brown';

    // 4. Hair style normalization
    let hairStyle = String(overrides.hairStyle || raw.hairStyle || '').trim();

    return {
        hasHeadwear,
        headwearType,
        headwearColor,
        headwearDescription,
        hasGlasses,
        glassesDescription,
        skinTone,
        hairStyle
    };
}

/**
 * Extracts visual attributes from a reference photo (data URL, base64, or remote URL)
 * @param {string} photoData - Base64 data URI or HTTP image URL
 * @param {object} clientOverrides - Optional manual tags from parent/form
 * @returns {Promise<object>} Normalized attribute object
 */
async function extractPhotoVisualAttributes(photoData, clientOverrides = {}) {
    // If client provided complete explicit attributes or no photo is present
    if (!photoData || typeof photoData !== 'string' || photoData.trim().length === 0) {
        return normalizeAttributes({}, clientOverrides);
    }

    // Check in-memory cache first
    const photoKey = crypto.createHash('sha256').update(photoData.slice(0, 4000)).digest('hex').slice(0, 16);
    if (attributeCache.has(photoKey)) {
        console.log(`⚡ [AttributeExtractor] Cache hit for photo hash ${photoKey}`);
        return normalizeAttributes(attributeCache.get(photoKey), clientOverrides);
    }

    // If no Replicate token configured, fallback gracefully to normalized client overrides
    if (!replicate) {
        console.warn('⚠️ [AttributeExtractor] No REPLICATE_API_TOKEN available. Using default/client overrides.');
        return normalizeAttributes({}, clientOverrides);
    }

    const t0 = Date.now();
    const prompt = `Analyze this reference photo of a child for an illustrated children's storybook.
Carefully identify distinctive visual and cultural attributes so the illustrator can accurately represent the child.
Output ONLY a valid JSON object with these exact keys:
{
  "hasHeadwear": boolean,
  "headwearType": "turban" | "patka" | "dastar" | "rumal" | "hijab" | "cap" | "hat" | "none",
  "headwearColor": string (e.g. "blue", "orange", "yellow", "red", "black", or ""),
  "headwearDescription": string (e.g. "traditional blue turban", "orange patka", or ""),
  "hasGlasses": boolean,
  "glassesDescription": string (e.g. "round black spectacles", "wireframe glasses", or ""),
  "skinTone": string (e.g. "warm golden brown", "fair", "deep brown", "warm honey"),
  "hairStyle": string (e.g. "dark hair under turban", "short black curls", "soft dark waves")
}
Do NOT include markdown formatting or commentary. Return only the raw JSON string.`;

    try {
        console.log(`🔍 [AttributeExtractor] Analyzing reference photo for cultural & visual attributes...`);

        // Run with 4.5-second timeout race to ensure preview latency remains snappy
        const visionPromise = replicate.run("google/gemini-2.5-flash", {
            input: {
                prompt: prompt,
                image: photoData
            }
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Attribute extraction timed out after 4500ms')), 4500);
        });

        const rawOutput = await Promise.race([visionPromise, timeoutPromise]);
        const outputStr = Array.isArray(rawOutput) ? rawOutput.join('') : String(rawOutput || '');

        // Extract JSON block
        const cleanJson = outputStr
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        const parsed = JSON.parse(cleanJson);
        const normalized = normalizeAttributes(parsed, clientOverrides);

        // Cache result
        attributeCache.set(photoKey, normalized);

        console.log(`✅ [AttributeExtractor] Detected attributes in ${Date.now() - t0}ms:`, {
            headwear: normalized.hasHeadwear ? normalized.headwearDescription : 'none',
            glasses: normalized.hasGlasses ? normalized.glassesDescription : 'none',
            skinTone: normalized.skinTone
        });

        return normalized;
    } catch (err) {
        console.warn(`⚠️ [AttributeExtractor] Notice (${err.message}). Using fallback attributes.`);
        const fallback = normalizeAttributes({}, clientOverrides);
        return fallback;
    }
}

module.exports = {
    extractPhotoVisualAttributes,
    normalizeAttributes,
    attributeCache
};
