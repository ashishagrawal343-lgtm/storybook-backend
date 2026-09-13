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
        description: 'Large cinematic full-bleed scene where the child is the prominent hero (60-65% visual weight) actively interacting with the theme environment, with generous upper breathing space for title typography.',
        compositionPrompt: 'cinematic wide-angle children\'s picture book cover scene; the child is the undeniable central protagonist commanding 60 to 65 percent of the composition, standing confidently and joyfully in the theme world; the upper 30 percent of the illustration is an open, tranquil, uncluttered sky with generous breathing space reserved for typography',
        negativeSpaceZone: 'top',
        characterScale: 'large-prominent',
        childPosition: 'center-lower'
    },

    EDITORIAL_PORTRAIT: {
        key: 'EDITORIAL_PORTRAIT',
        name: 'Editorial Portrait (Hero Spotlight)',
        description: 'The child is in the spotlight as the clear hero in 3/4 or full figure, framed naturally by environmental elements (stardust, jungle branches, coral, roses) with sophisticated editorial hierarchy.',
        compositionPrompt: 'stunning editorial children\'s storybook hero portrait; the child hero is prominently featured in three-quarter view occupying 60 to 65 percent of the frame with a soulful, joyful expression, framed naturally by atmospheric theme elements; upper third is calm, clean, softly gradient negative space',
        negativeSpaceZone: 'top',
        characterScale: 'hero-spotlight',
        childPosition: 'center'
    },

    FRAMED_WORLD: {
        key: 'FRAMED_WORLD',
        name: 'Framed World (Natural Storytelling Device)',
        description: 'A sophisticated natural or architectural framing device (flowering tree canopy, celestial stardust arch, glowing coral terrace) organically surrounds the storytelling scene with the child in the center.',
        compositionPrompt: 'masterpiece children\'s picture book cover with an organic natural framing device; lush theme-specific boughs and luminous elements curve gently along the edges, focusing all attention on the child protagonist who commands 60 percent of the inner world; calm negative space at top center for title',
        negativeSpaceZone: 'top-center',
        characterScale: 'centered-hero',
        childPosition: 'center'
    },

    STORY_MOMENT: {
        key: 'STORY_MOMENT',
        name: 'Story Moment (Active Narrative)',
        description: 'Captures a specific intriguing moment from the story where the child is actively doing something wondrous (holding glowing embers, discovering hidden tracks, smiling with a companion creature).',
        compositionPrompt: 'captivating narrative story moment for a luxury children\'s book cover; the child hero is actively engaged in a magical discovery, commanding 60 to 65 percent of the visual presence with wide sparkling eyes and joyful wonder; peaceful open sky above with zero clutter',
        negativeSpaceZone: 'top',
        characterScale: 'dynamic-hero',
        childPosition: 'center-lower'
    },

    MAGICAL_NEGATIVE_SPACE: {
        key: 'MAGICAL_NEGATIVE_SPACE',
        name: 'Magical Negative Space (Asymmetric Elegance)',
        description: 'The child occupies the lower-center of the composition with 60-65% presence, while the upper region intentionally contains elegant, peaceful visual calm for title typography.',
        compositionPrompt: 'poetic, modern picture book cover with intentional generous negative space; the child hero stands warmly in the lower two-thirds commanding 60 percent of the frame, bathed in gentle golden rim light; the upper 35 percent is a completely serene, tranquil, empty twilight atmosphere providing pristine clarity for text',
        negativeSpaceZone: 'top-wide',
        characterScale: 'lower-commanding',
        childPosition: 'lower-center'
    },

    THEME_SIGNATURE: {
        key: 'THEME_SIGNATURE',
        name: 'Theme Signature Composition',
        description: 'A composition tailored directly to the theme\'s iconic narrative element (e.g. constellation doorway in Space, prehistoric valley in Dino, coral palace in Ocean).',
        compositionPrompt: 'breathtaking theme-signature storybook cover scene; the child hero stands at the threshold of a wondrous theme landmark, commanding 60 to 65 percent of the frame as the brave leader of the adventure; open tranquil expanse in the upper third for typography',
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
