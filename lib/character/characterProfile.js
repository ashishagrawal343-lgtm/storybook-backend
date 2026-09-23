/**
 * TwinkleTale AI — Character Profile Engine
 * Establishes an immutable, isolated, per-order Character Profile.
 *
 * CRITICAL ISOLATION RULE:
 * Attributes belong exclusively to THIS child/session.
 * Never convert attributes into global defaults or mutate shared state.
 */

const crypto = require('crypto');

/**
 * Creates an isolated, sanitized Character Profile from extracted attributes and child metadata.
 * @param {object} params
 * @param {string} params.childName - Child's first name
 * @param {string} params.gender - Raw gender ('boy', 'girl', 'star', etc.)
 * @param {number|string} params.age - Child's age
 * @param {string} params.theme - Storybook theme
 * @param {string} params.photoData - Base64 data URL or HTTP image URL
 * @param {object} params.attributes - Raw visual attributes from vision extractor
 * @returns {object} Immutable Character Profile
 */
function createCharacterProfile({
    childName,
    gender,
    age,
    theme = 'Magical Forest',
    photoData = null,
    attributes = {}
}) {
    const cleanName = String(childName || 'Child').trim();
    const g = String(gender || '').toLowerCase().trim();

    let genderClean = 'boy';
    let pronoun = 'his';
    let subjectPronoun = 'he';

    if (g === 'girl' || g === 'female' || g === 'daughter' || g === 'f') {
        genderClean = 'girl';
        pronoun = 'her';
        subjectPronoun = 'she';
    } else if (g === 'neutral' || g === 'star' || g === 'star child' || g === 'little star' || g === 'they') {
        genderClean = 'little star';
        pronoun = 'their';
        subjectPronoun = 'they';
    } else {
        genderClean = 'boy';
        pronoun = 'his';
        subjectPronoun = 'he';
    }

    const childAge = parseInt(age, 10) || 5;

    // Theme-locked signature outfit to prevent wardrobe drift
    const t = String(theme || '').toLowerCase();
    let outfit = 'wearing a soft pastel mint-cream cotton t-shirt with a tiny embroidered golden star and cozy navy trousers';
    if (genderClean === 'girl') {
        if (t.includes('ocean') || t.includes('dolphin') || t.includes('mermaid')) {
            outfit = 'wearing a breezy sea-sparkle cyan sundress with a tiny golden shell pendant and soft matching hair ribbons';
        } else if (t.includes('space') || t.includes('star')) {
            outfit = 'wearing an enchanting starlight-navy adventure dress with golden stardust trim and matching ribbon in hair';
        } else if (t.includes('animal') || t.includes('forest') || t.includes('safari') || t.includes('jungle')) {
            outfit = 'wearing an adorable soft sage-green adventure pinafore dress over a cream blouse with tiny wildflower embroidery and delicate hair ribbons';
        } else if (t.includes('princess') || t.includes('castle') || t.includes('kingdom') || t.includes('magic') || t.includes('fairy')) {
            outfit = 'wearing an enchanted pastel lavender princess dress with shimmering golden star embroidery and delicate hair ribbons';
        } else if (t.includes('super')) {
            outfit = 'wearing a heroic soft crimson adventurer tunic with a golden star emblem and cute flutter cape';
        } else if (t.includes('dinosaur')) {
            outfit = 'wearing a warm amber-ochre explorer pinafore with little leaf patches over a cream tee with soft hair clips';
        } else if (t.includes('circus') || t.includes('carnival')) {
            outfit = 'wearing a festive berry-red and gold-trimmed carnival dress with playful ruffles';
        } else if (t.includes('lullaby') || t.includes('bedtime') || t.includes('cloud')) {
            outfit = 'wearing warm fluffy cloud-white bedtime nightgown sprinkled with tiny golden stars';
        } else {
            outfit = 'wearing an adorable soft pastel lavender-cream cotton dress with tiny embroidered golden stars and delicate ribbons';
        }
    } else {
        if (t.includes('ocean') || t.includes('dolphin') || t.includes('mermaid')) {
            outfit = 'wearing a cozy sea-breeze cyan star t-shirt and adventure trousers';
        } else if (t.includes('space') || t.includes('star')) {
            outfit = 'wearing a cozy midnight-blue star-patterned onesie with golden starlight trim';
        } else if (t.includes('animal') || t.includes('forest') || t.includes('safari') || t.includes('jungle')) {
            outfit = 'wearing a soft sage-green adventure vest over a cream cotton tee and khaki trousers';
        } else if (t.includes('princess') || t.includes('castle') || t.includes('kingdom') || t.includes('magic') || t.includes('fairy')) {
            outfit = 'wearing an enchanted pastel lavender tunic with tiny golden star embroidery';
        } else if (t.includes('super')) {
            outfit = 'wearing a heroic soft crimson tunic with a gentle golden sun emblem and cozy joggers';
        } else if (t.includes('dinosaur')) {
            outfit = 'wearing a warm amber-ochre explorer hoodie with little leaf patches and rolled trousers';
        } else if (t.includes('circus') || t.includes('carnival')) {
            outfit = 'wearing a festive berry-red and gold-trimmed festive tunic with playful suspenders';
        } else if (t.includes('lullaby') || t.includes('bedtime') || t.includes('cloud')) {
            outfit = 'wearing warm fluffy cloud-white bedtime pajamas sprinkled with tiny golden stars';
        }
    }

    // Isolate attributes strictly for THIS child
    const hasHeadwear = Boolean(attributes && attributes.hasHeadwear);
    const rawHeadwear = hasHeadwear
        ? String(attributes.headwearDescription || (attributes.headwearType && attributes.headwearType !== 'none' ? attributes.headwearType : '')).trim()
        : '';
    const cleanHeadwear = rawHeadwear.replace(/^authentic\s+/i, '');

    const hasGlasses = Boolean(attributes && attributes.hasGlasses);
    const glassesDescription = hasGlasses
        ? String(attributes.glassesDescription || 'spectacles').trim()
        : '';

    // Sanitizer-safe skin tone
    const skinTone = String((attributes && attributes.skinTone) || '').trim();

    // Hair style
    const hairStyle = String((attributes && attributes.hairStyle) || '').trim();

    // Source photo hash for caching & auditability
    let photoHash = null;
    if (photoData && typeof photoData === 'string' && photoData.length > 0) {
        const hashPayload = photoData.length > 64000 ? photoData.slice(0, 64000) : photoData;
        photoHash = crypto.createHash('sha256').update(hashPayload).digest('hex').slice(0, 20);
    }

    // Build head & hair description
    let headAndHairDesc = (genderClean === 'girl')
        ? 'charming little girl hairstyle with delicate hair ribbons, finely rendered natural hair catching the golden rim light'
        : 'finely rendered natural hair with golden rim lighting';
    if (hasHeadwear && cleanHeadwear) {
        headAndHairDesc = `wearing an authentic ${cleanHeadwear} with golden rim lighting`;
    } else if (hairStyle) {
        headAndHairDesc = `${hairStyle} with golden rim lighting`;
    }

    // Build extra features
    const extraFeatures = [];
    if (hasGlasses && glassesDescription) {
        extraFeatures.push(`wearing ${glassesDescription}`);
    }
    if (skinTone) {
        extraFeatures.push(`authentic ${skinTone} face colouring`);
    }
    const extraFeaturesStr = extraFeatures.length > 0 ? `, ${extraFeatures.join(', ')}` : '';

    const charAnchor = (genderClean === 'little star')
        ? `a cheerful young child hero with soulful sparkling dark eyes, charming button nose, joyful warm smile, ${headAndHairDesc}${extraFeaturesStr}, painterly storybook realism, ${outfit}`
        : `a cheerful young ${genderClean} hero with soulful sparkling dark eyes, charming button nose, joyful warm smile, ${headAndHairDesc}${extraFeaturesStr}, painterly storybook realism, ${outfit}`;

    const profile = Object.freeze({
        profileId: `prof_${crypto.randomBytes(8).toString('hex')}`,
        createdAt: Date.now(),
        photoHash,
        childName: cleanName,
        gender: genderClean,
        pronoun,
        subjectPronoun,
        age: childAge,
        theme,
        outfit,
        attributes: Object.freeze({
            hasHeadwear,
            headwearType: hasHeadwear ? (attributes.headwearType || cleanHeadwear) : 'none',
            headwearColor: hasHeadwear ? (attributes.headwearColor || '') : '',
            headwearDescription: cleanHeadwear,
            hasGlasses,
            glassesDescription,
            skinTone,
            hairStyle
        }),
        charAnchor,
        version: '1.0'
    });

    return profile;
}

module.exports = {
    createCharacterProfile
};
