/**
 * TwinkleTale AI — Cover Design Engine (v2)
 * High-level coordinator that manages prompt building, artwork generation,
 * compositing, QA validation, collision detection, and photo provenance
 * for ultra-premium children's book covers.
 *
 * IDENTITY PARITY DESIGN (matches interior page generation):
 * - Uses the original customer photo directly as the flux-kontext-pro visual condition
 * - NO intermediate avatar transformation step (that step was causing attribute loss)
 * - Same weighted-token prefix pattern as interior pages: (wearing spectacles:1.3)
 * - Attributes (glasses, headwear, face colouring) are preserved via prompt tokens + photo conditioning
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
const { createCharacterProfile } = require('../character/characterProfile');
const { getOrGenerateCharacterMaster } = require('../character/characterMaster');
const { getOrGenerateCharacterSheet } = require('../character/characterSheet');

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
     * 1. Prepares theme & archetype plan (via buildCoverPrompt — includes attribute tokens)
     * 2. Establishes and validates CoverDesignSpec contract
     * 3. Generates cover artwork using photo-conditioned identity (original photo → flux-kontext-pro)
     *    — same approach as interior pages, which preserve attributes correctly
     * 4. Fetches raw artwork buffer
     * 5. Composites editorial typography & gradient scrim
     * 6. Runs collision & safe-zone rule engine (and generates visual debug overlay)
     * 7. Runs QA runner pre-flight checks
     *
     * IMPORTANT: No avatar transformation step. The original customer photo IS the identity anchor.
     * Attribute preservation (glasses, turban, face colouring) is handled by:
     *   a) Weighted prompt tokens: (wearing spectacles:1.3) at token positions 0-25
     *   b) Directive clauses: [CRITICAL VISUAL FEATURE: ...] in the prompt
     *   c) flux-kontext-pro photo conditioning on the raw photo (strongest fidelity source)
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

        // ── IDENTITY ANCHOR ─────────────────────────────────────────────────────────
        // Use the original uploaded customer photo directly as the visual condition
        // for flux-kontext-pro — this is identical to how interior pages work and
        // ensures maximum attribute fidelity (glasses, headwear, face colouring).
        //
        // If an explicit referencePortraitUrl was already provided (e.g. from a prior
        // avatar generation or locked portrait), use that instead.
        //
        // NO intermediate avatar transformation is performed. The avatar step was
        // causing attribute loss because:
        //   1. sanitizePromptForSafety() mutated "skin tone/complexion" → garbage tokens
        //   2. The transformation added distracting outfit/pose text that competed with
        //      the photo conditioning signal
        //   3. Attributes detected on the avatar were weaker than on the raw photo
        // ────────────────────────────────────────────────────────────────────────────
        let photoAssetId = null;
        let characterReferenceAssetId = null;
        let characterReferenceUrl = referencePortraitUrl || null;
        let visualCondition = referencePortraitUrl
            ? String(referencePortraitUrl)
            : (photoData || null);

        if (!characterReferenceUrl && photoData && typeof this.generateAvatar === 'function') {
            try {
                characterReferenceUrl = await this.generateAvatar(photoData, charAnchor, attributes);
                if (characterReferenceUrl) {
                    visualCondition = characterReferenceUrl;
                }
            } catch (avatarErr) {
                console.warn(`⚠️ [CoverEngine v2] Avatar generator notice (${avatarErr.message}). Falling back directly to photoData.`);
                visualCondition = photoData;
            }
        }

        if (photoData) {
            photoAssetId = `photo_${crypto.createHash('sha256').update(String(photoData).slice(0, 1000)).digest('hex').slice(0, 12)}`;
            characterReferenceAssetId = photoAssetId;
        }
        if (characterReferenceUrl) {
            characterReferenceAssetId = `ref_${crypto.createHash('sha256').update(String(characterReferenceUrl)).digest('hex').slice(0, 12)}`;
            console.log(`🔗 [CoverEngine v2] Reusing pre-supplied character reference portrait: ${characterReferenceUrl}`);
        }

        if (visualCondition) {
            const src = referencePortraitUrl ? 'reference portrait' : 'original photo (direct conditioning)';
            const glassesTag = (attributes && attributes.hasGlasses) ? ` | glasses: ${attributes.glassesDescription || 'spectacles'}` : '';
            const headwearTag = (attributes && attributes.hasHeadwear) ? ` | headwear: ${attributes.headwearDescription || attributes.headwearType}` : '';
            const toneTag = (attributes && attributes.skinTone) ? ` | face colouring: ${attributes.skinTone}` : '';
            console.log(`🎨 [CoverEngine v2] Identity anchor: ${src}${glassesTag}${headwearTag}${toneTag}`);
        } else {
            console.log(`🎨 [CoverEngine v2] No photo — text-to-image cover for "${childName}"`);
        }

        // ── COVER DESIGN SPEC ────────────────────────────────────────────────────────
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

        console.log(`🎨 [CoverEngine v2] Generating cover artwork for "${childName}" | Theme: ${plan.themeMaster.themeName} | Archetype: ${plan.archetype.name} | Photo-conditioned: ${!!visualCondition}`);

        // ── STEP 2.5: ESTABLISH IMMUTABLE CHARACTER MASTER v1 ─────────────────────────
        // Generated exactly ONCE per unique photo hash, cached permanently in memory & disk.
        // Acts as the single canonical visual reference for Cover and Interior Pages.
        const characterProfile = createCharacterProfile({
            childName,
            gender,
            age,
            theme,
            photoData,
            attributes
        });

        let characterMaster = null;
        let characterSheet = null;
        if (photoData) {
            try {
                characterMaster = await getOrGenerateCharacterMaster({
                    photoData,
                    profile: characterProfile,
                    generateImageFn: genFn
                });
                if (characterMaster) {
                    characterSheet = await getOrGenerateCharacterSheet({
                        characterMaster,
                        profile: characterProfile
                    });
                }
            } catch (cmErr) {
                console.warn(`⚠️ [CoverEngine v2] Character Master notice (${cmErr.message}). Continuing with direct photo conditioning.`);
            }
        }

        // ── STEP 3: GENERATE COVER ARTWORK ──────────────────────────────────────────
        // The positivePrompt from buildCoverPrompt contains:
        //   • Weighted attribute tokens at the front: (wearing spectacles:1.3), (wearing authentic turban:1.35)
        //   • Directive clauses: [CRITICAL VISUAL FEATURE: ...], [NATURAL FACE COLOURING: ...]
        //   • Negative attribute tokens passed separately
        // Condition directly on photoData (or Character Master if pre-supplied) at 3:4 aspect ratio.
        const artUrlResult = await genFn(plan.positivePrompt, visualCondition, {
            aspect_ratio: '3:4',
            isFace: true,
            prompt_upsampling: false
        });

        if (!artUrlResult) {
            throw new Error('[CoverEngine v2] AI image generator returned an empty URL for cover artwork');
        }
        const artUrlRaw = String(artUrlResult);

        if (!characterReferenceUrl) {
            characterReferenceUrl = (characterMaster && characterMaster.masterUrl)
                ? String(characterMaster.masterUrl)
                : (referencePortraitUrl ? String(referencePortraitUrl) : null);
        }

        if (characterReferenceAssetId && designSpec && designSpec.provenance) {
            designSpec.provenance.characterReferenceAssetId = characterReferenceAssetId;
        }

        // ── STEP 4: FETCH ARTWORK BUFFER ─────────────────────────────────────────────
        const rawArtBuffer = await fetchFn(artUrlRaw);

        // ── STEP 5: COMPOSITE TYPOGRAPHY OVERLAY ────────────────────────────────────
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

        // ── STEP 6: COLLISION & SAFE-ZONE RULES ──────────────────────────────────────
        const collisionResults = await evaluateCollisionRules(compositedBuffer, designSpec, {
            bookTitle: effectiveTitle,
            childName
        });

        if (!collisionResults.valid) {
            console.warn('⚠️ [CoverEngine v2] Collision rule violations:', collisionResults.ruleResults.filter(r => !r.passed));
        } else {
            console.log('✅ [CoverEngine v2] All 9 Collision & Safe-Zone Rules Passed cleanly');
        }

        // ── STEP 7: QA PRE-FLIGHT ────────────────────────────────────────────────────
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
            characterReferenceUrl: characterReferenceUrl || (characterMaster ? characterMaster.masterUrl : artUrlRaw),
            characterMaster,
            characterSheet,
            characterProfile,
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
