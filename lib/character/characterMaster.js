/**
 * TwinkleTale AI — Character Master v1
 * Generates and stores the single canonical visual identity of the child
 * for the entire storybook.
 *
 * IMMUTABILITY GUARANTEE:
 * Generated ONCE per order/session. Reused across Cover and All Interior Pages.
 * Cached by photo hash on disk and in memory.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const characterMasterCache = new Map();
const booksFolder = path.join(__dirname, '..', '..', 'books');

/**
 * Builds the canonical prompt for the 1:1 Character Master
 */
function buildCharacterMasterPrompt(profile) {
    const attrs = profile.attributes || {};
    
    // Headwear directive
    let headwearDirective = '[STRICT HEADWEAR RESTRICTION: The child has natural hair with NO headwear, NO hat, NO cap. Strictly preserve their natural hair and hairline.] ';
    let forbiddenHeadwear = ['hats', 'caps', 'head coverings', 'turbans', 'crowns'];
    if (attrs.hasHeadwear && attrs.headwearDescription) {
        headwearDirective = `[CRITICAL CULTURAL ACCURACY: The child is wearing an authentic ${attrs.headwearDescription}; faithfully preserve this exact headwear with its exact color, shape, and fabric; do NOT replace it with any cap, hat, or alternative covering.] `;
        forbiddenHeadwear = ['generic caps', 'baseball caps', 'helmets', 'costume hats'];
    }

    // Glasses directive
    let glassesDirective = '[STRICT EYEWEAR RESTRICTION: The child does NOT wear glasses. Strictly preserve their natural face with zero eyewear of any kind.] ';
    let forbiddenGlasses = ['spectacles', 'glasses', 'sunglasses', 'eyewear', 'frames'];
    if (attrs.hasGlasses) {
        const desc = attrs.glassesDescription || 'spectacles';
        glassesDirective = `[CRITICAL VISUAL FEATURE: The child is wearing ${desc}; faithfully and accurately preserve the ${desc} on their face in the illustration.] `;
        forbiddenGlasses = ['sunglasses', 'distorted frames'];
    }

    // Forbidden props
    const forbiddenItems = ['extra handheld props', 'unneeded costume accessories', ...forbiddenHeadwear, ...forbiddenGlasses];
    const exclusionClause = `absolutely NO ${forbiddenItems.join(', NO ')}`;

    // Skin colouring (sanitizer safe)
    const skinPhrase = attrs.skinTone
        ? `exact ${attrs.skinTone} face colouring exactly as in the reference photo`
        : `exact face colouring and pigmentation precisely as in the reference photo`;

    return `Transform the child in this photo into an adorable, charming storybook hero in lush painterly storybook realism, soft digital gouache and fine oils texture, gentle cinematic golden lighting. ${headwearDirective}${glassesDirective}[CRITICAL IDENTITY PRESERVATION: Preserve 90-95% facial likeness: exact eye shape, iris color, eyebrow arch, nose bridge, nose tip, mouth contour, ${skinPhrase}, hairstyle, hair texture, and natural hairline.] Centered head-and-shoulders portrait of the child in ${profile.outfit || 'a cozy storybook adventure outfit'}, eye level, face fully in frame with generous margin around hair and chin, portrait orientation. Warm lifelike glow, authentic happy smile, finely rendered hair catching gentle rim light. Rich picture book artistry, digital gouache and fine oils. Not flat 2D cartoon, not stiff 3D CGI, not plastic, no text, no watermark, ${exclusionClause}`;
}

/**
 * Retrieves an existing Character Master from memory or disk cache
 */
function getCachedCharacterMaster(photoHash) {
    if (!photoHash) return null;
    if (characterMasterCache.has(photoHash)) {
        return characterMasterCache.get(photoHash);
    }
    const diskPath = path.join(booksFolder, `char_master_${photoHash}.json`);
    if (fs.existsSync(diskPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
            characterMasterCache.set(photoHash, data);
            return data;
        } catch (_) {}
    }
    return null;
}

/**
 * Saves a Character Master to memory and disk cache
 */
function saveCharacterMaster(photoHash, masterData) {
    if (!photoHash || !masterData) return;
    characterMasterCache.set(photoHash, masterData);
    try {
        const diskPath = path.join(booksFolder, `char_master_${photoHash}.json`);
        fs.writeFileSync(diskPath, JSON.stringify(masterData, null, 2));
    } catch (err) {
        console.warn(`⚠️ [CharacterMaster] Could not cache to disk:`, err.message);
    }
}

/**
 * Generates or retrieves the immutable Character Master v1.
 * Guaranteed to run ONCE per source photo hash.
 */
async function getOrGenerateCharacterMaster({
    photoData,
    profile,
    generateImageFn
}) {
    if (!photoData || typeof generateImageFn !== 'function') {
        return null;
    }

    const photoHash = profile.photoHash || crypto.createHash('sha256').update(photoData.slice(0, 64000)).digest('hex').slice(0, 20);

    // 1. Check if Character Master v1 already exists (Immutability rule)
    const existing = getCachedCharacterMaster(photoHash);
    if (existing && existing.masterUrl) {
        console.log(`🔒 [CharacterMaster v1] Immutable master cache HIT for ${profile.childName} (hash: ${photoHash}): ${existing.masterUrl}`);
        return existing;
    }

    // 2. Generate Character Master v1 exactly once
    console.log(`🎨 [CharacterMaster v1] Generating canonical Character Master for ${profile.childName} (Glasses: ${profile.attributes.hasGlasses}, Headwear: ${profile.attributes.hasHeadwear})...`);
    const prompt = buildCharacterMasterPrompt(profile);
    const t0 = Date.now();

    const masterUrl = await generateImageFn(prompt, photoData, {
        aspect_ratio: '1:1',
        isFace: true,
        upscale: false,
        prompt_upsampling: false
    });

    if (!masterUrl) {
        throw new Error('[CharacterMaster v1] Image generation failed to return Master URL');
    }

    const masterData = {
        characterMasterId: `cm_${photoHash}_v1`,
        characterMasterVersion: '1.0',
        photoHash,
        childName: profile.childName,
        masterUrl: String(masterUrl),
        modelUsed: 'black-forest-labs/flux-kontext-pro',
        aspectRatio: '1:1',
        generatedAt: Date.now(),
        latencyMs: Date.now() - t0,
        attributesLocked: profile.attributes,
        promptVersion: 'cm_v1.0'
    };

    saveCharacterMaster(photoHash, masterData);
    console.log(`✅ [CharacterMaster v1] Locked canonical identity in ${((Date.now() - t0)/1000).toFixed(1)}s: ${masterData.masterUrl}`);

    return masterData;
}

module.exports = {
    getOrGenerateCharacterMaster,
    getCachedCharacterMaster,
    saveCharacterMaster,
    buildCharacterMasterPrompt
};
