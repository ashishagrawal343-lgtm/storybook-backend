/**
 * TwinkleTale AI — Cover Prompt Builder
 * Assembles art-directed prompts for cover generation that guarantee:
 *  1. The child protagonist is the central spotlight commanding 60-65% of the cover area.
 *  2. Modern, editorial children's picture-book aesthetics (no medallion circles or fake frames).
 *  3. Upper 30% tranquil open negative space reserved for typography.
 *  4. Theme-authentic world-building, palette, and lighting from Theme Master Constitutions.
 *  5. Strict exclusion of AI-generated text, letters, borders, and watermarks.
 */

const { getThemeMaster } = require('./themeMasters');
const { selectArchetype, getArchetype } = require('./archetypes');

function buildCoverPrompt(themeInput, archetypeInput, child, options = {}) {
    const themeMaster = (themeInput && typeof themeInput === 'object' && themeInput.themeKey)
        ? themeInput
        : getThemeMaster(themeInput || 'Forest & Animals');

    const archetype = (archetypeInput && typeof archetypeInput === 'object' && archetypeInput.key)
        ? archetypeInput
        : (archetypeInput ? getArchetype(archetypeInput) : selectArchetype(themeMaster, options.seed, child?.name, options.bookTitle));

    const childAnchor = child?.charAnchor || (
        `${child?.name || 'A child'}, a cheerful ${child?.age || 5}-year-old ${child?.gender || 'little star'} hero`
    );

    const childRole = themeMaster.childRole || 'A curious and brave young explorer';
    const heroAction = themeMaster.heroAction || 'standing joyfully in wonder, smiling with sparkle in their eyes';
    const motifs = (themeMaster.allowedMotifs && themeMaster.allowedMotifs.join(', ')) || 'magical sparkles, glowing elements';

    // 1. Core Art Direction & Safe-Zone Framing (Upper Title Zone + Dedicated Lower Hero Window)
    const stylePrefix = "Masterpiece modern children's picture book cover illustration, award-winning editorial painterly realism, fine digital gouache and luminous artisan oils:";
    const headroomDirective = "Cinematic establishing camera view with generous open vertical headroom: the entire top 35 to 40 percent of the canvas is an open, tranquil, uncluttered sky or atmospheric expanse with soft luminous lighting and pristine breathing space reserved exclusively for the book title; the child protagonist is framed strictly within the dedicated lower hero zone (occupying the lower 60 to 65 percent of the canvas height), with the child's entire figure fitted comfortably to this hero window from head to feet;";

    // 2. Composition & Archetype Directive
    const compositionPart = archetype.compositionPrompt;

    // 3. Child Hero Spotlight Directive (Guarantees Fit-to-Window & Zero Cropping of Hero)
    const heroSpotlightPart = `${childAnchor} as ${childRole}, the central heroic focal point occupying 60 to 65 percent of the canvas, beautifully framed and fitted to the dedicated lower hero window: ${heroAction}; beautifully proportioned full-length storybook illustration with generous visual margin around the child's attire, shoes, and hair; wide soulful sparkling eyes, an authentic radiant smile of delight and wonder, gentle luminous warmth, crisp expressive facial features, and proud heroic posture; the child's head and hair remain strictly below the 35 percent horizontal line with zero encroachment into the upper title zone;`;

    // 4. Theme World Building & Atmosphere
    const worldPart = `Theme setting: ${themeMaster.visualNorthStar}; iconic elements: ${motifs}; lighting: ${themeMaster.lighting}; color harmony: deep atmospheric tones (${themeMaster.palette.primary || '#1b263b'}), luminous warm accent (${themeMaster.palette.accent || '#f6d365'});`;

    // 5. Strict Exclusion of Text & Clutter
    const exclusionPart = `Pure environmental illustration only; absolutely NO text, NO words, NO letters, NO font, NO numbers, NO alphabet, NO watermark, NO logo, NO borders, NO picture frames, NO medallion rings, NO circular vignettes.`;

    const positivePrompt = `${stylePrefix} ${headroomDirective} ${compositionPart}. ${heroSpotlightPart} ${worldPart} ${exclusionPart}`;

    const negativePrompt = "character head in upper third, head above 35% line, hair in upper third, character head near top edge, head cropped at top, hat touching top edge, feet cut off, legs cropped at bottom, cropped feet, shoes cut off, body cut in half, floating torso, close-up shot, medium shot, three-quarter crop, head and shoulders only, tall character filling entire frame vertically, small headroom, lack of headroom, text, words, letters, typography, font, title, name, alphabet, label, watermark, logo, trademark, sign, banner, border, frame, medallion, circle cutout, border frame, blurry, lowres, deformed hands, extra fingers, deformed face, poorly drawn face, bad anatomy, flat lighting, gloomy";

    return {
        positivePrompt,
        negativePrompt,
        themeMaster,
        archetype,
        childAnchor,
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
