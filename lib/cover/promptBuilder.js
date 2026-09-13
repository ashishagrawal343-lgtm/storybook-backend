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
    const themeMaster = (typeof themeInput === 'object' && themeInput.themeKey)
        ? themeInput
        : getThemeMaster(themeInput || 'Forest & Animals');

    const archetype = (typeof archetypeInput === 'object' && archetypeInput.key)
        ? archetypeInput
        : (archetypeInput ? getArchetype(archetypeInput) : selectArchetype(themeMaster, options.seed, child?.name, options.bookTitle));

    const childAnchor = child?.charAnchor || (
        `${child?.name || 'A child'}, a cheerful ${child?.age || 5}-year-old ${child?.gender || 'little star'} hero`
    );

    const childRole = themeMaster.childRole || 'A curious and brave young explorer';
    const heroAction = themeMaster.heroAction || 'standing joyfully in wonder, smiling with sparkle in their eyes';
    const motifs = (themeMaster.allowedMotifs && themeMaster.allowedMotifs.join(', ')) || 'magical sparkles, glowing elements';

    // 1. Core Art Direction
    const stylePrefix = "Masterpiece modern children's picture book cover illustration, award-winning editorial painterly realism, fine digital gouache and luminous artisan oils:";

    // 2. Composition & Archetype Directive
    const compositionPart = archetype.compositionPrompt;

    // 3. Child Hero Spotlight Directive (Guarantees 60-65% area weight)
    const heroSpotlightPart = `${childAnchor} as ${childRole}, commanding 60 to 65 percent of the cover illustration as the central heroic focal point, ${heroAction}; positioned prominently in the center and lower two-thirds of the canvas with wide soulful sparkling eyes, an authentic radiant smile of delight and wonder, natural dimensional skin tones with gentle warmth, crisp expressive features, and heroic posture;`;

    // 4. Theme World Building & Atmosphere
    const worldPart = `Theme setting: ${themeMaster.visualNorthStar}; iconic elements: ${motifs}; lighting: ${themeMaster.lighting}; color harmony: deep atmospheric tones (${themeMaster.palette.primary || '#1b263b'}), luminous warm accent (${themeMaster.palette.accent || '#f6d365'});`;

    // 5. Negative Space for Typography
    const negativeSpacePart = `Compositional balance: the upper 28 to 32 percent of the canvas is an open, tranquil, peaceful twilight sky with soft ambient atmosphere and ample clean negative space reserved for book title; seamless full-bleed page art with no clutter at the top;`;

    // 6. Strict Exclusion of Text & Clutter
    const exclusionPart = `Pure environmental illustration only; absolutely NO text, NO words, NO letters, NO font, NO numbers, NO alphabet, NO watermark, NO logo, NO borders, NO picture frames, NO medallion rings, NO circular vignettes.`;

    const positivePrompt = `${stylePrefix} ${compositionPart}. ${heroSpotlightPart} ${worldPart} ${negativeSpacePart} ${exclusionPart}`;

    const negativePrompt = "text, words, letters, typography, font, title, name, alphabet, label, watermark, logo, trademark, sign, banner, border, frame, medallion, circle cutout, border frame, blurry, lowres, deformed hands, extra fingers, deformed face, poorly drawn face, bad anatomy, flat lighting, gloomy";

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
