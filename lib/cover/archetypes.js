/**
 * TwinkleTale AI — Cover Composition Archetypes & Variation Engine
 * Implements 6 controlled, premium picture-book cover archetypes
 * and deterministic seeded selection to eliminate cookie-cutter repetition.
 */

const crypto = require('crypto');

const COVER_ARCHETYPES = {
    HERO_SCENE: {
        key: 'HERO_SCENE',
        name: 'Hero Scene (Cinematic Picture-Book)',
        description: 'Large cinematic full-bleed scene where the child is the prominent hero (60-65% visual weight) standing in the lower two-thirds, with generous upper breathing space for title typography.',
        compositionPrompt: 'cinematic wide-angle children\'s picture book cover scene; the child is the undeniable central protagonist commanding 60 to 65 percent of the composition, standing joyfully on the ground plane in the lower two-thirds of the canvas; the child\'s entire head, hair, and any hats stay strictly within the lower 65 percent of the image; the entire upper 35 percent of the illustration is an open, tranquil, uncluttered sky with pristine breathing space reserved for typography',
        negativeSpaceZone: 'top',
        characterScale: 'large-prominent',
        childPosition: 'center-lower'
    },

    EDITORIAL_PORTRAIT: {
        key: 'EDITORIAL_PORTRAIT',
        name: 'Editorial Spotlight (Three-Quarter Figure)',
        description: 'The child is in the spotlight as the clear hero in three-quarter or full figure standing in the center-lower canvas, framed naturally by environmental elements with clear upper negative space.',
        compositionPrompt: 'stunning editorial children\'s storybook hero scene; the child protagonist is prominently featured in three-quarter figure occupying 60 to 65 percent of the frame, standing grounded in the center-lower two-thirds with a soulful, joyful expression; the child\'s head and any hats remain strictly below the top 33 percent horizontal line; the entire upper third is calm, clean, open negative space sky',
        negativeSpaceZone: 'top',
        characterScale: 'hero-spotlight',
        childPosition: 'center-lower'
    },

    FRAMED_WORLD: {
        key: 'FRAMED_WORLD',
        name: 'Framed World (Natural Storytelling Device)',
        description: 'A sophisticated natural or architectural framing device organically surrounds the storytelling scene with the child standing in the lower center.',
        compositionPrompt: 'masterpiece children\'s picture book cover with an organic natural framing device; lush theme-specific boughs and luminous elements curve gently along the lower and side edges only, focusing all attention on the child protagonist who commands 60 to 65 percent of the inner world in the center-lower frame; child head strictly below top 33 percent; calm empty open negative space across the entire top third for title',
        negativeSpaceZone: 'top',
        characterScale: 'centered-hero',
        childPosition: 'center-lower'
    },

    STORY_MOMENT: {
        key: 'STORY_MOMENT',
        name: 'Story Moment (Active Narrative)',
        description: 'Captures a specific intriguing moment where the child is actively doing something wondrous in the lower-center canvas with wide open sky above.',
        compositionPrompt: 'captivating narrative story moment for a luxury children\'s book cover; the child hero is actively engaged in a magical discovery in the lower-center of the canvas, commanding 60 to 65 percent of the visual presence with wide sparkling eyes; the child\'s head and accessories remain strictly within the lower 65 percent of the frame; peaceful open sky above with zero clutter',
        negativeSpaceZone: 'top',
        characterScale: 'dynamic-hero',
        childPosition: 'center-lower'
    },

    MAGICAL_NEGATIVE_SPACE: {
        key: 'MAGICAL_NEGATIVE_SPACE',
        name: 'Magical Negative Space (Asymmetric Elegance)',
        description: 'The child occupies the lower-center of the composition with 60-65% presence, while the upper region intentionally contains elegant, peaceful visual calm for title typography.',
        compositionPrompt: 'poetic, modern picture book cover with intentional generous negative space; the child hero stands warmly in the lower two-thirds commanding 60 to 65 percent of the frame, bathed in gentle golden rim light; the child\'s entire head is strictly below the top 35 percent horizontal line; the upper 35 percent is a completely serene, tranquil, empty atmosphere providing pristine clarity for text',
        negativeSpaceZone: 'top-wide',
        characterScale: 'lower-commanding',
        childPosition: 'center-lower'
    },

    THEME_SIGNATURE: {
        key: 'THEME_SIGNATURE',
        name: 'Theme Signature Composition',
        description: 'A composition tailored directly to the theme\'s iconic narrative landmark with the child standing proudly in the foreground.',
        compositionPrompt: 'breathtaking theme-signature storybook cover scene; the child hero stands in the center-lower foreground commanding 60 to 65 percent of the frame as the brave leader of the adventure; child head strictly below top 33 percent horizontal line; open tranquil expanse in the upper third for typography',
        negativeSpaceZone: 'top',
        characterScale: 'landmark-hero',
        childPosition: 'center-lower'
    }
};

/**
 * Deterministically selects a compatible archetype based on seed, theme, and child name.
 * Guarantees reproducibility for the same order while preventing catalog repetition.
 */
function selectArchetype(themeMaster, seed, childName, bookTitle) {
    const list = (themeMaster && Array.isArray(themeMaster.compatibleArchetypes) && themeMaster.compatibleArchetypes.length > 0)
        ? themeMaster.compatibleArchetypes
        : Object.keys(COVER_ARCHETYPES);

    const hashInput = `${seed || 'default'}_${themeMaster.themeKey}_${childName || 'child'}_${bookTitle || 'adventure'}`;
    const hash = crypto.createHash('md5').update(hashInput).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16) % list.length;
    const selectedKey = list[index];

    return COVER_ARCHETYPES[selectedKey] || COVER_ARCHETYPES.HERO_SCENE;
}

function getArchetype(key) {
    return COVER_ARCHETYPES[key] || COVER_ARCHETYPES.HERO_SCENE;
}

module.exports = {
    COVER_ARCHETYPES,
    selectArchetype,
    getArchetype
};
