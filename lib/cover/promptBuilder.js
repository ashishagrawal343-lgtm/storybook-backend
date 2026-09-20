/**
 * TwinkleTale AI — Cover Prompt Builder
 * Assembles art-directed prompts for cover generation that guarantee:
 *  1. The child protagonist is the central spotlight commanding 60-65% of the cover area.
 *  2. Modern, editorial children's picture-book aesthetics (no medallion circles or fake frames).
 *  3. Upper 30% tranquil open negative space reserved for typography.
 *  4. Theme-authentic world-building, palette, and lighting from Theme Master Constitutions.
 *  5. Strict exclusion of AI-generated text, letters, borders, and watermarks.
 */

const { getThemeMaster, sanitizeChildRoleForHeadwear } = require('./themeMasters');
const { selectArchetype, getArchetype } = require('./archetypes');

function buildCoverPrompt(themeInput, archetypeInput, child, options = {}) {
    const themeMaster = (themeInput && typeof themeInput === 'object' && themeInput.themeKey)
        ? themeInput
        : getThemeMaster(themeInput || 'Forest & Animals');

    const archetype = (archetypeInput && typeof archetypeInput === 'object' && archetypeInput.key)
        ? archetypeInput
        : (archetypeInput ? getArchetype(archetypeInput) : selectArchetype(themeMaster, options.seed, child?.name, options.bookTitle));

    const attributes = options.attributes || child?.attributes || {};

    const childAnchor = child?.charAnchor || (
        `a cheerful young ${child?.gender === 'girl' ? 'girl' : (child?.gender === 'boy' ? 'boy' : 'child')} hero named ${child?.name || 'the young explorer'}`
    );

    // Sanitize theme childRole to remove any conflicting hats (conductor cap, top hat, flower crown)
    const rawChildRole = themeMaster.childRole || 'A curious and brave young explorer';
    const childRole = sanitizeChildRoleForHeadwear(rawChildRole, attributes);

    const heroAction = themeMaster.heroAction || 'standing joyfully in wonder, smiling with sparkle in their eyes';

    // Motifs (strictly filter out crowns, tiaras, hats, caps, or glasses)
    let allowedMotifs = themeMaster.allowedMotifs || ['magical sparkles', 'glowing elements'];
    if (attributes.hasHeadwear) {
        allowedMotifs = allowedMotifs.filter(m => !/crown|hat|cap|tiara/i.test(m));
    } else {
        allowedMotifs = allowedMotifs.filter(m => !/crown|hat|cap|tiara|headwear/i.test(m));
    }
    const motifs = allowedMotifs.join(', ');

    // 0. Distinctive Visual & Cultural Attribute Injection (Tokens 0-25 for highest cross-attention weight)
    let attributePrefix = '';
    let attributeDirectives = '';
    let attributeNegativeTokens = [];
    let headwearExclusion = '';

    if (attributes && attributes.hasHeadwear && (attributes.headwearDescription || (attributes.headwearType && attributes.headwearType !== 'none'))) {
        const rawDesc = String(attributes.headwearDescription || attributes.headwearType || '').trim();
        if (rawDesc && rawDesc.toLowerCase() !== 'none') {
            const cleanDesc = rawDesc.replace(/^authentic\s+/i, '');
            attributePrefix += `(wearing an authentic ${cleanDesc}:1.35), `;
            attributeDirectives += `[CRITICAL CULTURAL ACCURACY: The child is wearing an authentic ${cleanDesc} from the reference photo. Faithfully preserve this ${cleanDesc} in fine storybook detail. Strictly maintain this authentic headwear.] `;
            headwearExclusion = ` absolutely NO generic hats, NO caps, NO alternative headwear replacing the child's authentic ${cleanDesc}.`;
            attributeNegativeTokens.push(
                'cap', 'hat', 'baseball cap', 'beanie', 'helmet', 'conductor cap', 'top hat',
                'fedora', 'crown', 'flower crown', 'party hat', 'visor'
            );
            if (/turban|patka|dastar|pagri|rumal/i.test(cleanDesc)) {
                attributeNegativeTokens.push(
                    'bare head', 'exposed hair replacing turban', 'generic cap', 'wrong headwear',
                    'altered turban', 'missing turban', 'distorted turban'
                );
            }
        }
    } else {
        // STRICT NON-REGRESSION: Child has natural hair in the uploaded photo
        attributeDirectives += `[STRICT NATURAL HAIR: Strictly maintain the child's natural hair, hair texture, hairstyle, and natural hairline exactly as shown in the reference photo with natural unadorned hair and zero headwear.] `;
        attributeNegativeTokens.push(
            'hat', 'cap', 'baseball cap', 'beanie',
            'helmet', 'crown', 'tiara', 'flower crown', 'visor', 'headband', 'bonnet', 'hood', 'head covering'
        );
    }

    if (attributes && attributes.hasGlasses) {
        const glassesDesc = attributes.glassesDescription || 'spectacles';
        attributePrefix += `(wearing ${glassesDesc}:1.3), `;
        attributeDirectives += `[CRITICAL VISUAL FEATURE: The child is wearing ${glassesDesc}. Faithfully preserve the ${glassesDesc} centered naturally on the child's face.] `;
        attributeNegativeTokens.push(
            'sunglasses', 'missing glasses', 'removed glasses', 'no glasses',
            'wrong glasses', 'distorted spectacles', 'extra frames'
        );
    } else {
        // STRICT NON-REGRESSION: Child does NOT wear glasses in the uploaded photo
        attributeDirectives += `[STRICT NATURAL EYES: Strictly preserve the child's natural face, eyes, and unobstructed eye area exactly as shown in the reference photo with zero eyewear.] `;
        attributeNegativeTokens.push(
            'glasses', 'spectacles', 'sunglasses', 'eyewear', 'frames', 'goggles', 'monocle', 'reading glasses'
        );
    }

    // STRICT NON-REGRESSION: Forbid unnecessary props or costume accessories not in user photo
    attributeDirectives += `[STRICT NO-PROPS RULE: Strictly maintain the child's natural physical appearance as-is from the user uploaded photo with zero extra props, zero costume accessories, and zero handheld items.] `;
    attributeNegativeTokens.push(
        'unnecessary props', 'extra props', 'costume props', 'costume accessories', 'fake props', 'handheld props',
        'spectacles on child without glasses', 'hat on natural-haired child'
    );

    if (attributes && attributes.skinTone) {
        attributePrefix += `(authentic ${attributes.skinTone} skin:1.2), `;
        attributeDirectives += `[NATURAL FACE COLOURING: Preserve the child's authentic ${attributes.skinTone} face colouring and pigmentation from the reference photo without darkening or lightening.] `;
        attributeNegativeTokens.push(
            'incorrect face colouring', 'altered ethnicity', 'darkened face', 'lightened face', 'wrong pigmentation'
        );
    }

    // Facial likeness & structure preservation directive (90-95% fidelity in lush painterly realism)
    // NOTE: avoid "skin tone" — it gets scrubbed by sanitizePromptForSafety → use "face colouring" instead
    const likenessDirective = "[PORTRAIT FIDELITY: Maintain 90% to 95% authentic facial likeness from the reference photo: preserve exact eye shape, iris tone, eyebrow contour, nose bridge and tip, mouth and lip shape, authentic happy smile, and exact face colouring from the photo without cartoon or CGI distortion, while seamlessly rendered in lush painterly storybook realism, soft digital gouache and fine oils texture, and gentle golden rim lighting.] ";

    // 1. Core Art Direction & Safe-Zone Framing (Upper Title Zone + Dedicated Lower Hero Window)
    const stylePrefix = "Masterpiece modern children's picture book cover illustration in lush painterly storybook realism, soft digital gouache and fine luminous oils texture, cinematic volumetric lighting:";
    const headroomDirective = "Cinematic establishing camera view with generous open vertical headroom: the entire top 35 to 40 percent of the canvas is an open, tranquil, uncluttered sky or atmospheric expanse with soft luminous lighting and pristine breathing space reserved exclusively for the book title; the child protagonist is framed strictly within the dedicated lower hero zone (occupying the lower 60 to 65 percent of the canvas height), with the child's entire figure fitted comfortably to this hero window from head to feet;";

    // 2. Composition & Archetype Directive
    const compositionPart = archetype.compositionPrompt;

    // 3. Child Hero Spotlight Directive (Guarantees Fit-to-Window & Zero Cropping of Hero)
    // NOTE: avoid "skin tones" — gets scrubbed → use "face colouring" instead
    const heroSpotlightPart = `${childAnchor} as ${childRole}, the central heroic focal point occupying 60 to 65 percent of the canvas, beautifully framed and fitted to the dedicated lower hero window: ${heroAction}; beautifully proportioned full-length storybook illustration with generous visual margin around the child's attire, shoes, and hair; soft warm luminous face colouring faithfully preserved from the reference photo, finely rendered hair catching gentle rim light, wide soulful sparkling eyes, an authentic radiant smile of delight and wonder, rich painterly material texture, and proud heroic posture; the child's head and hair remain strictly below the 35 percent horizontal line with zero encroachment into the upper title zone;`;

    // 4. Theme World Building & Atmosphere
    const worldPart = `Theme setting: ${themeMaster.visualNorthStar}; iconic elements: ${motifs}; lighting: ${themeMaster.lighting}; color harmony: deep atmospheric tones (${themeMaster.palette.primary || '#1b263b'}), luminous warm accent (${themeMaster.palette.accent || '#f6d365'});`;

    // 5. Strict Exclusion of Text & Clutter
    const exclusionPart = `Pure environmental illustration only; absolutely NO text, NO words, NO letters, NO font, NO numbers, NO alphabet, NO watermark, NO logo, NO borders, NO picture frames, NO medallion rings, NO circular vignettes.`;

    const positivePrompt = `${attributePrefix}${stylePrefix} ${attributeDirectives}${likenessDirective}${headroomDirective} ${compositionPart}. ${heroSpotlightPart} ${worldPart} ${exclusionPart}${headwearExclusion}`;

    const baseNegative = "3d cgi, plastic render, unreal engine, pixar 3d, 3d animation, glossy plastic, toy-like, doll-like, plastic skin, plastic face, shiny rubber skin, flat 2d cartoon, lowres, stiff 3d model, action figure, figurine, videogame character, character head in upper third, head above 35% line, hair in upper third, character head near top edge, head cropped at top, hat touching top edge, feet cut off, legs cropped at bottom, cropped feet, shoes cut off, body cut in half, floating torso, close-up shot, medium shot, three-quarter crop, head and shoulders only, tall character filling entire frame vertically, small headroom, lack of headroom, text, words, letters, typography, font, title, name, alphabet, label, watermark, logo, trademark, sign, banner, border, frame, medallion, circle cutout, border frame, blurry, deformed hands, extra fingers, deformed face, poorly drawn face, bad anatomy, flat lighting, gloomy";

    const negativePrompt = (attributeNegativeTokens.length > 0)
        ? `${attributeNegativeTokens.join(', ')}, ${baseNegative}`
        : baseNegative;

    return {
        positivePrompt,
        negativePrompt,
        themeMaster,
        archetype,
        childAnchor,
        attributes,
        metadata: {
            themeKey: themeMaster.themeKey,
            archetypeKey: archetype.key,
            negativeSpaceZone: archetype.negativeSpaceZone,
            heroAreaTarget: '60-65%'
        }
    };
}

module.exports = {
    buildCoverPrompt
};

