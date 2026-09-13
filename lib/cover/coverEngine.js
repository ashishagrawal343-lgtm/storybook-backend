/**
 * TwinkleTale AI — Cover Design Engine (v2)
 * High-level coordinator that manages prompt building, artwork generation,
 * compositing, QA validation, and fallback for ultra-premium children's book covers.
 */

const { getThemeMaster } = require('./themeMasters');
const { selectArchetype, getArchetype } = require('./archetypes');
const { buildCoverPrompt } = require('./promptBuilder');
const { renderEditorialCoverComposite } = require('./compositeRenderer');
const { validateCoverOutput } = require('./qaRunner');
const { calculateCoverZones } = require('./zoneCalculator');

class CoverDesignEngine {
    constructor(options = {}) {
        this.generateImage = options.generateImage || null;
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
        seed = null
    }) {
        const themeMaster = getThemeMaster(theme);
        const archetype = archetypeKey
            ? getArchetype(archetypeKey)
            : selectArchetype(themeMaster, seed, childName, bookTitle);

        const childInfo = {
            name: childName,
            gender,
            age,
            charAnchor
        };

        const promptData = buildCoverPrompt(themeMaster, archetype, childInfo, {
            bookTitle,
            language,
            seed
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
     * 2. Calls AI image generator (with photoData if available)
     * 3. Fetches raw artwork buffer
     * 4. Composites editorial typography & gradient scrim
     * 5. Runs automated QA validation
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
        archetypeKey = null,
        seed = null,
        generateImageFn = null,
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

        const plan = this.prepareCoverPlan({
            theme,
            childName,
            gender,
            age,
            charAnchor,
            bookTitle,
            language,
            archetypeKey,
            seed
        });

        console.log(`🎨 [CoverEngine v2] Generating cover for "${childName}" | Theme: ${plan.themeMaster.themeName} | Archetype: ${plan.archetype.name} (Hero Target: 60-65%)`);

        // 1. Generate pure artwork (guaranteed no text/medallions)
        const artUrlRaw = await genFn(plan.positivePrompt, photoData, {
            aspect_ratio: '3:4',
            isFace: true
        });

        if (!artUrlRaw) {
            throw new Error('[CoverEngine v2] AI image generator returned an empty URL for cover artwork');
        }

        // 2. Fetch raw artwork buffer
        const rawArtBuffer = await fetchFn(artUrlRaw);

        // 3. Composite editorial typography overlay
        const compositedBuffer = await renderEditorialCoverComposite(rawArtBuffer, {
            childName,
            bookTitle: bookTitle || `${childName}'s Adventure`,
            themeMaster: plan.themeMaster,
            lang: language,
            width: 600,
            height: 800
        });

        // 4. Quality Assurance pre-flight check
        const qa = await validateCoverOutput(compositedBuffer, {
            expectedWidth: 600,
            expectedHeight: 800,
            bookTitle
        });

        if (!qa.valid) {
            console.warn('⚠️ [CoverEngine v2] QA validation warnings:', qa.errors.concat(qa.warnings));
        } else {
            console.log(`✅ [CoverEngine v2] QA Passed: ${qa.metrics.width}x${qa.metrics.height}, ${qa.metrics.sizeBytes} bytes, Hero Area Ratio: ${qa.metrics.heroAreaRatio * 100}%`);
        }

        return {
            coverBuffer: compositedBuffer,
            rawArtUrl: artUrlRaw,
            plan,
            qa
        };
    }
}

module.exports = {
    CoverDesignEngine
};
