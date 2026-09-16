/**
 * TwinkleTale AI — Cover Design Engine (v2)
 * High-level coordinator that manages prompt building, artwork generation,
 * compositing, QA validation, collision detection, and photo provenance
 * for ultra-premium children's book covers.
 */

const crypto = require('crypto');
const { getThemeMaster } = require('./themeMasters');
const { selectArchetype, getArchetype } = require('./archetypes');
const { buildCoverPrompt } = require('./promptBuilder');
const { renderEditorialCoverComposite } = require('./compositeRenderer');
const { validateCoverOutput } = require('./qaRunner');
const { calculateCoverZones } = require('./zoneCalculator');
const { createCoverDesignSpec, validateCoverDesignSpec } = require('./designSpec');
const { evaluateCollisionRules } = require('./collisionEngine');

class CoverDesignEngine {
    constructor(options = {}) {
        this.generateImage = options.generateImage || null;
        this.generateAvatar = options.generateAvatar || null;
        this.fetchImageBuffer = options.fetchImageBuffer || null;
    }

    /**
     * Builds the complete prompt and composition metadata for a cover.
     */
    prepareCoverPlan({
        theme,
        childName,
        gender,
        age,
        charAnchor,
        bookTitle,
        language = 'en',
        archetypeKey = null,
        seed = null,
        attributes = null
    }) {
        const themeMaster = getThemeMaster(theme);
        const archetype = archetypeKey
            ? getArchetype(archetypeKey)
            : selectArchetype(themeMaster, seed, childName, bookTitle);

        const childInfo = {
            name: childName,
            gender,
            age,
            charAnchor,
            attributes
        };

        const promptData = buildCoverPrompt(themeMaster, archetype, childInfo, {
            bookTitle,
            language,
            seed,
            attributes
        });

        const zones = calculateCoverZones(600, 800);

        return {
            themeMaster,
            archetype,
            positivePrompt: promptData.positivePrompt,
            negativePrompt: promptData.negativePrompt,
            zones,
            metadata: {
                version: 'v2',
                themeKey: themeMaster.themeKey,
                archetypeKey: archetype.key,
                childName,
                bookTitle,
                language,
                heroAreaTarget: '60-65%'
            }
        };
    }

    /**
     * Executes end-to-end reimagined cover generation:
     * 1. Prepares theme & archetype plan
     * 2. Establishes and validates CoverDesignSpec contract
     * 3. Handles Photo-Conditioned Identity Anchor (CUSTOMER PHOTO -> AVATAR ANCHOR)
     * 4. Calls AI image generator (conditioned on avatar anchor for character identity)
     * 5. Fetches raw artwork buffer
     * 6. Composites editorial typography & gradient scrim
     * 7. Runs collision & safe-zone rule engine (and generates visual debug overlay)
     * 8. Runs QA runner pre-flight checks
     */
    async generateCover({
        theme,
        childName,
        gender,
        age,
        charAnchor,
        bookTitle,
        language = 'en',
        photoData = null,
        referencePortraitUrl = null,
        archetypeKey = null,
        seed = null,
        attributes = null,
        generateImageFn = null,
        generateAvatarFn = null,
        fetchBufferFn = null
    }) {
        const genFn = generateImageFn || this.generateImage;
        const avatarFn = generateAvatarFn || this.generateAvatar;
        const fetchFn = fetchBufferFn || this.fetchImageBuffer;

        if (!genFn || typeof genFn !== 'function') {
            throw new Error('[CoverDesignEngine] No generateImage function provided');
        }
        if (!fetchFn || typeof fetchFn !== 'function') {
            throw new Error('[CoverDesignEngine] No fetchImageBuffer function provided');
        }

        const rawTitleForPlan = (bookTitle && typeof bookTitle.then === 'function') ? null : bookTitle;
        const plan = this.prepareCoverPlan({
            theme,
            childName,
            gender,
            age,
            charAnchor,
            bookTitle: rawTitleForPlan,
            language,
            archetypeKey,
            seed,
            attributes
        });

        // Step 1: Resolve Character Reference Anchor (Customer Photo -> Premium Storybook Avatar Anchor)
        let characterReferenceUrl = referencePortraitUrl ? String(referencePortraitUrl) : null;
        let photoAssetId = null;
        let characterReferenceAssetId = null;

        if (photoData) {
            photoAssetId = `photo_${crypto.createHash('sha256').update(String(photoData).slice(0, 1000)).digest('hex').slice(0, 12)}`;
        }

        if (characterReferenceUrl) {
            characterReferenceAssetId = `ref_${crypto.createHash('sha256').update(characterReferenceUrl).digest('hex').slice(0, 12)}`;
            console.log(`🔗 [CoverEngine v2] Reusing existing character reference anchor: ${characterReferenceUrl}`);
        } else if (photoData && avatarFn && typeof avatarFn === 'function') {
            try {
                console.log(`🎨 [CoverEngine v2] Transforming customer photo into premium painterly storybook avatar for "${childName}"...`);
                const avatarUrl = await avatarFn(photoData, charAnchor, attributes);
                if (avatarUrl) {
                    characterReferenceUrl = String(avatarUrl);
                    characterReferenceAssetId = `ref_${crypto.createHash('sha256').update(characterReferenceUrl).digest('hex').slice(0, 12)}`;
                    console.log(`✅ [CoverEngine v2] Premium painterly character anchor locked: ${characterReferenceUrl}`);
                }
            } catch (avatarErr) {
                console.warn(`⚠️ [CoverEngine v2] Avatar transformation notice (${avatarErr.message}). Falling back to direct photo conditioning...`);
            }
        } else if (photoData) {
            console.log(`👤 [CoverEngine v2] Direct photo conditioning active for "${childName}"...`);
        }

        // Step 2: Establish and Validate CoverDesignSpec Contract
        const designSpec = createCoverDesignSpec({
            theme,
            childName,
            gender,
            age,
            bookTitle: rawTitleForPlan,
            language,
            photoData,
            referenceAssetId: photoAssetId,
            characterReferenceAssetId,
            archetypeKey: plan.archetype.key,
            seed,
            width: 600,
            height: 800
        });

        const specValidation = validateCoverDesignSpec(designSpec);
        if (!specValidation.valid) {
            console.warn('⚠️ [CoverEngine v2] CoverDesignSpec validation warnings:', specValidation.errors);
        }

        console.log(`🎨 [CoverEngine v2] Generating cover artwork for "${childName}" | Theme: ${plan.themeMaster.themeName} | Archetype: ${plan.archetype.name} (Hero Target: 60-65%)`);

        // Step 3: Generate pure artwork conditioned on the character reference anchor
        // passing characterReferenceUrl (or photoData fallback) as visual condition
        const visualCondition = characterReferenceUrl ? String(characterReferenceUrl) : (photoData || null);
        const artUrlResult = await genFn(plan.positivePrompt, visualCondition, {
            aspect_ratio: '3:4',
            isFace: true,
            negative_prompt: plan.negativePrompt,
            prompt_upsampling: false,
            reference_strength: 0.85,
            image_weight: 0.85,
            denoising_strength: 0.45
        });

        if (!artUrlResult) {
            throw new Error('[CoverEngine v2] AI image generator returned an empty URL for cover artwork');
        }
        const artUrlRaw = String(artUrlResult);
        if (!characterReferenceUrl) {
            characterReferenceUrl = artUrlRaw;
            characterReferenceAssetId = `cover_${crypto.createHash('sha256').update(characterReferenceUrl).digest('hex').slice(0, 12)}`;
            console.log(`✅ [CoverEngine v2] Cover character anchor locked: ${characterReferenceUrl}`);
        }
        if (characterReferenceAssetId && designSpec && designSpec.provenance) {
            designSpec.provenance.characterReferenceAssetId = characterReferenceAssetId;
        }

        // Step 4: Fetch raw artwork buffer
        const rawArtBuffer = await fetchFn(artUrlRaw);

        // Step 5: Composite editorial typography overlay (resolves asynchronous title if running in parallel)
        const resolvedTitle = (bookTitle && typeof bookTitle.then === 'function')
            ? await bookTitle
            : bookTitle;
        const effectiveTitle = (resolvedTitle && String(resolvedTitle).trim()) || `${childName}'s Adventure`;
        designSpec.bookTitle = effectiveTitle;
        if (plan.metadata) {
            plan.metadata.bookTitle = effectiveTitle;
        }

        const compositedBuffer = await renderEditorialCoverComposite(rawArtBuffer, {
            childName,
            bookTitle: effectiveTitle,
            themeMaster: plan.themeMaster,
            lang: language,
            width: 600,
            height: 800
        });

        // Step 6: Evaluate Safe-Zone Collision Rules and generate debug overlay
        const collisionResults = await evaluateCollisionRules(compositedBuffer, designSpec, {
            bookTitle: effectiveTitle,
            childName
        });

        if (!collisionResults.valid) {
            console.warn('⚠️ [CoverEngine v2] Collision rule violations:', collisionResults.ruleResults.filter(r => !r.passed));
        } else {
            console.log('✅ [CoverEngine v2] All 9 Collision & Safe-Zone Rules Passed cleanly');
        }

        // Step 7: Quality Assurance pre-flight check
        const qa = await validateCoverOutput(compositedBuffer, {
            expectedWidth: 600,
            expectedHeight: 800,
            bookTitle: effectiveTitle
        });

        if (!qa.valid) {
            console.warn('⚠️ [CoverEngine v2] QA validation warnings:', qa.errors.concat(qa.warnings));
        } else {
            console.log(`✅ [CoverEngine v2] QA Passed: ${qa.metrics.width}x${qa.metrics.height}, ${qa.metrics.sizeBytes} bytes, Hero Area Ratio: ${qa.metrics.heroAreaRatio * 100}%`);
        }

        return {
            coverBuffer: compositedBuffer,
            rawArtUrl: artUrlRaw,
            characterReferenceUrl,
            designSpec,
            collisionResults,
            debugOverlayBuffer: collisionResults.debugOverlayBuffer,
            provenance: designSpec.provenance,
            plan,
            qa
        };
    }
}

module.exports = {
    CoverDesignEngine
};
