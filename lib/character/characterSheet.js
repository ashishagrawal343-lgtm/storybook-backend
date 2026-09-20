/**
 * TwinkleTale AI — Character Sheet v1
 * Generates and stores a secondary canonical visual reference derived from
 * Character Master v1 (establishing full-body framing, proportions, and signature theme wardrobe).
 *
 * IMMUTABILITY GUARANTEE:
 * Established once per Character Master, cached deterministically, and never mutated.
 */

const fs = require('fs');
const path = require('path');

const characterSheetCache = new Map();
const booksFolder = path.join(__dirname, '..', '..', 'books');

/**
 * Retrieves cached Character Sheet v1
 */
function getCachedCharacterSheet(characterMasterId) {
    if (!characterMasterId) return null;
    if (characterSheetCache.has(characterMasterId)) {
        return characterSheetCache.get(characterMasterId);
    }
    const diskPath = path.join(booksFolder, `char_sheet_${characterMasterId}.json`);
    if (fs.existsSync(diskPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
            characterSheetCache.set(characterMasterId, data);
            return data;
        } catch (_) {}
    }
    return null;
}

/**
 * Saves Character Sheet v1 to cache
 */
function saveCharacterSheet(characterMasterId, sheetData) {
    if (!characterMasterId || !sheetData) return;
    characterSheetCache.set(characterMasterId, sheetData);
    try {
        const diskPath = path.join(booksFolder, `char_sheet_${characterMasterId}.json`);
        fs.writeFileSync(diskPath, JSON.stringify(sheetData, null, 2));
    } catch (err) {
        console.warn(`⚠️ [CharacterSheet] Could not cache to disk:`, err.message);
    }
}

/**
 * Creates or retrieves the Character Sheet v1 specification.
 * If optional full-body visual generation is enabled, conditions on Character Master.
 * Otherwise, generates a structured canonical sheet contract mapping to the Character Master.
 */
async function getOrGenerateCharacterSheet({
    characterMaster,
    profile,
    generateImageFn = null,
    enableVisualSheet = false
}) {
    if (!characterMaster || !characterMaster.masterUrl) {
        return null;
    }

    const masterId = characterMaster.characterMasterId;

    // Check cache
    const existing = getCachedCharacterSheet(masterId);
    if (existing) {
        return existing;
    }

    let sheetUrl = characterMaster.masterUrl;

    // If explicit visual sheet rendering is enabled and generator provided
    if (enableVisualSheet && typeof generateImageFn === 'function') {
        try {
            console.log(`🎨 [CharacterSheet v1] Generating 3:4 canonical full-body sheet for ${profile.childName}...`);
            const sheetPrompt = `Masterpiece children's picture book character model sheet: full-length standing pose of the exact same child hero from the reference image, facing camera with a cheerful friendly smile, showcasing complete signature outfit (${profile.outfit || 'adventure outfit'}). Clean plain neutral parchment background, soft even studio lighting, full body in frame from head to shoes with generous margins, zero cropping. Not flat 2D cartoon, not 3D CGI plastic render, no text, no watermark.`;
            const resultUrl = await generateImageFn(sheetPrompt, characterMaster.masterUrl, {
                aspect_ratio: '3:4',
                isFace: true,
                upscale: false,
                prompt_upsampling: false
            });
            if (resultUrl) {
                sheetUrl = String(resultUrl);
                console.log(`✅ [CharacterSheet v1] Full-body canonical sheet ready: ${sheetUrl}`);
            }
        } catch (err) {
            console.warn(`⚠️ [CharacterSheet v1] Visual sheet fallback to master portrait:`, err.message);
        }
    }

    const sheetData = {
        characterSheetId: `cs_${masterId}`,
        characterMasterId: masterId,
        version: '1.0',
        childName: profile.childName,
        sheetUrl,
        primaryPortraitUrl: characterMaster.masterUrl,
        canonicalWardrobe: profile.outfit,
        attributes: profile.attributes,
        generatedAt: Date.now()
    };

    saveCharacterSheet(masterId, sheetData);
    return sheetData;
}

module.exports = {
    getOrGenerateCharacterSheet,
    getCachedCharacterSheet,
    saveCharacterSheet
};
