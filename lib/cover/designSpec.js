/**
 * TwinkleTale AI — Cover Design Spec (Execution Contract)
 * Establishes a deterministic geometric and semantic contract for book covers.
 * Guarantees zone-first execution:
 *  - Title Zone & Child Name Zone (Upper 32.5%, strictly protected)
 *  - Hero Spotlight Zone (60-65% surface area, anchored in lower two-thirds)
 *  - Branding / Publisher Zone (Discrete footer)
 *  - Full Photo-Provenance Traceability
 */

const crypto = require('crypto');
const { calculateCoverZones } = require('./zoneCalculator');
const { getThemeMaster } = require('./themeMasters');
const { selectArchetype, getArchetype } = require('./archetypes');

/**
 * Creates a deterministic CoverDesignSpec contract.
 */
function createCoverDesignSpec({
    theme,
    childName = 'Child',
    gender = 'little star',
    age = 5,
    bookTitle = '',
    language = 'en',
    photoData = null,
    referenceAssetId = null,
    characterReferenceAssetId = null,
    archetypeKey = null,
    seed = null,
    width = 600,
    height = 800
}) {
    const themeMaster = getThemeMaster(theme);
    const archetype = archetypeKey
        ? getArchetype(archetypeKey)
        : selectArchetype(themeMaster, seed, childName, bookTitle);

    const zones = calculateCoverZones(width, height);
    const creativeSeed = seed || `${childName}_${themeMaster.themeKey}_${Date.now()}`;

    // Compute photo asset ID if raw photo was provided but no ID passed
    let computedPhotoId = referenceAssetId;
    if (!computedPhotoId && photoData) {
        computedPhotoId = `photo_${crypto.createHash('sha256').update(String(photoData).slice(0, 1000)).digest('hex').slice(0, 12)}`;
    }

    const spec = {
        version: '2.1.0',
        contractType: 'CoverDesignSpec',
        archetype: archetype.key,
        archetypeName: archetype.name,
        themeKey: themeMaster.themeKey,
        themeName: themeMaster.themeName,

        canvas: {
            width,
            height,
            aspectRatio: width / height,
            totalArea: width * height
        },

        zones: {
            safeMargin: {
                top: zones.margins.top,
                bottom: zones.margins.bottom,
                left: zones.margins.left,
                right: zones.margins.right
            },
            bleed: {
                top: 0,
                bottom: 0,
                left: 0,
                right: 0
            },
            childNameZone: {
                x: zones.titleZone.x,
                y: zones.titleZone.y + Math.round(height * 0.05), // ~84px
                width: zones.titleZone.width,
                height: 30,
                fontSize: 11,
                letterSpacing: 2.5,
                alignment: 'center'
            },
            titleZone: {
                x: zones.titleZone.x,
                y: zones.titleZone.y, // ~44px
                width: zones.titleZone.width,
                height: zones.titleZone.height, // ~176px
                bottomY: zones.titleZone.bottomY, // ~220px (Strict upper boundary)
                maxLines: 2,
                fontSize: 31,
                alignment: 'center',
                safePaddingBottom: 20 // 20px gap before hero zone starts
            },
            heroZone: {
                x: zones.heroZone.x,
                y: zones.titleZone.bottomY + 20, // ~240px
                width: zones.heroZone.width,
                height: zones.footerZone.y - 4 - (zones.titleZone.bottomY + 20), // 500px @ 800
                bottomY: zones.footerZone.y - 4, // ~740px (Strict lower boundary before branding)
                areaRatio: zones.heroZone.areaRatio, // 0.60 - 0.65
                minHeadroomRatio: 0.35, // 35% empty vertical sky
                maxHeadY: Math.round(height * 0.33) // Child head must be at or below ~264px
            },
            brandingZone: {
                x: zones.footerZone.x,
                y: zones.footerZone.y, // ~744px
                width: zones.footerZone.width,
                height: zones.footerZone.height, // ~28px
                text: 'T W I N K L E T A L E   P U B L I S H I N G',
                fontSize: 10,
                alignment: 'center'
            }
        },

        composition: {
            heroPosition: 'lower-middle',
            visualFocalPoint: 'child',
            negativeSpace: 'upper-middle',
            cameraAngle: 'eye-level-wide',
            allowCircularMedallion: false // Strictly forbidden
        },

        typography: {
            titleStyle: {
                fontFamily: "'Playfair Display', Georgia, serif",
                fontSize: 31,
                fontWeight: '700',
                line1Color: '#FFFFFF',
                line2Color: themeMaster.palette.accent || '#f6d365',
                filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.92)) drop-shadow(0 1px 3px rgba(0,0,0,0.85))'
            },
            nameStyle: {
                fontFamily: "'Montserrat', 'Helvetica Neue', Arial, sans-serif",
                fontSize: 11,
                fontWeight: '700',
                color: themeMaster.palette.accent || '#f6d365',
                letterSpacing: '2.5px',
                filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.85))'
            },
            brandingStyle: {
                fontFamily: "'Montserrat', 'Helvetica Neue', Arial, sans-serif",
                fontSize: 10,
                fontWeight: '600',
                color: '#FFFFFF',
                letterSpacing: '3.0px',
                opacity: 0.80
            }
        },

        provenance: {
            coverSourceType: photoData ? 'customer-photo' : 'curated-character',
            referenceAssetId: computedPhotoId || 'none',
            characterReferenceAssetId: characterReferenceAssetId || 'none',
            coverPipelineVersion: 'v2',
            themeMasterVersion: '2.1.0',
            coverArchetype: archetype.key,
            creativeSeed: String(creativeSeed),
            renderVersion: '2.1.0',
            generatedAt: new Date().toISOString()
        }
    };

    return spec;
}

/**
 * Validates a CoverDesignSpec against architectural rules.
 */
function validateCoverDesignSpec(spec) {
    const errors = [];
    const warnings = [];

    if (!spec || typeof spec !== 'object') {
        return { valid: false, errors: ['Spec is null or invalid object'], warnings: [] };
    }

    // 1. Canvas sanity
    if (!spec.canvas || spec.canvas.width < 500 || spec.canvas.height < 700) {
        errors.push('Canvas dimensions below minimum preview threshold');
    }

    // 2. Zone non-overlap checks
    const { titleZone, heroZone, brandingZone } = spec.zones || {};
    if (!titleZone || !heroZone || !brandingZone) {
        errors.push('Missing essential zones (titleZone, heroZone, brandingZone)');
    } else {
        if (titleZone.bottomY > heroZone.y) {
            errors.push(`Title zone (${titleZone.bottomY}px) collides with hero zone (${heroZone.y}px)`);
        }
        if (heroZone.bottomY > brandingZone.y) {
            errors.push(`Hero zone (${heroZone.bottomY}px) collides with branding zone (${brandingZone.y}px)`);
        }
        if (heroZone.areaRatio < 0.58 || heroZone.areaRatio > 0.68) {
            warnings.push(`Hero area ratio (${(heroZone.areaRatio * 100).toFixed(1)}%) is outside recommended 60-65% target`);
        }
    }

    // 3. Provenance validation
    if (!spec.provenance || !spec.provenance.coverPipelineVersion) {
        errors.push('Missing provenance metadata');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

module.exports = {
    createCoverDesignSpec,
    validateCoverDesignSpec
};
