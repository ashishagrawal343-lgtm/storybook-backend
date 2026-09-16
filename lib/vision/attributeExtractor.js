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

    // 1. Headwear normalization: strictly conditional on clear evidence, NEVER defaulted
    let hasHeadwear = false;
    let headwearType = 'none';
    let headwearColor = '';
    let headwearDescription = '';

    // If client explicitly checked/provided an override:
    if (overrides.hasHeadwear !== undefined) {
        hasHeadwear = !!overrides.hasHeadwear;
        headwearType = String(overrides.headwearType || 'none').toLowerCase().trim();
        headwearColor = String(overrides.headwearColor || '').trim();
        headwearDescription = String(overrides.headwearDescription || '').trim();
    } else if (raw && raw.hasHeadwear) {
        // Raw vision detection
        const rawType = String(raw.headwearType || 'none').toLowerCase().trim();
        // Strict whitelist of genuine headwear tokens (excluding 'none', '', or generic words)
        const recognizedHeadwear = ['turban', 'patka', 'dastar', 'pagri', 'rumal', 'hijab', 'cap', 'hat'];
        const matched = recognizedHeadwear.find(t => rawType.includes(t));
        if (matched) {
            hasHeadwear = true;
            headwearType = matched;
            headwearColor = String(raw.headwearColor || '').trim();
            headwearDescription = String(raw.headwearDescription || '').trim();
        } else {
            hasHeadwear = false;
            headwearType = 'none';
        }
    }

    if (hasHeadwear && headwearType !== 'none') {
        if (!headwearDescription) {
            const colorPrefix = headwearColor ? `${headwearColor} ` : '';
            headwearDescription = `${colorPrefix}${headwearType}`.trim();
        }
    } else {
        // Guarantee clean non-headwear state: zero tokens, zero description
        hasHeadwear = false;
        headwearType = 'none';
        headwearColor = '';
        headwearDescription = '';
    }

    // 2. Glasses / Spectacles normalization
    let hasGlasses = overrides.hasGlasses !== undefined
        ? !!overrides.hasGlasses
        : !!raw.hasGlasses;

    let glassesDescription = String(overrides.glassesDescription || raw.glassesDescription || '').trim();
    if (hasGlasses && !glassesDescription) {
        glassesDescription = 'charming spectacles';
    } else if (!hasGlasses) {
        glassesDescription = '';
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

    // Check in-memory cache first (hash with 64KB entropy to avoid header collision)
    const hashData = photoData.length > 64000 ? photoData.slice(0, 64000) : photoData;
    const photoKey = crypto.createHash('sha256').update(hashData).digest('hex').slice(0, 20);
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
    const prompt = `You are an expert children's portrait analyzer. Analyze this reference photo of a child for an illustrated storybook character.
CRITICAL HEADWEAR & ACCURACY RULES:
1. Most children have natural, bare hair and do NOT wear any headwear.
2. If the child has natural hair (straight, wavy, curly, afro-textured, braids, ponytail, fade, or bare head), you MUST set "hasHeadwear": false, "headwearType": "none", "headwearColor": "", "headwearDescription": "".
3. Do NOT confuse curly hair, voluminous hair, high necklines, collars, or headbands with headwear.
4. ONLY set "hasHeadwear": true if the child is undeniably wearing an authentic cultural/religious fabric head covering (such as a turban, patka, dastar, pagri, rumal, or hijab) or a distinct hat/cap.

Output ONLY a valid JSON object with these exact keys:
{
  "hasHeadwear": boolean,
  "headwearType": "turban" | "patka" | "dastar" | "rumal" | "hijab" | "cap" | "hat" | "none",
  "headwearColor": string (e.g. "blue", "orange", or ""),
  "headwearDescription": string (e.g. "navy blue turban", "orange patka", or ""),
  "hasGlasses": boolean,
  "glassesDescription": string (e.g. "round black spectacles", "wireframe glasses", or ""),
  "skinTone": string (e.g. "warm golden brown", "fair", "deep brown", "warm honey"),
  "hairStyle": string (e.g. "natural dark curly hair", "short black hair", or "dark hair under turban" only if headwear is worn)
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
