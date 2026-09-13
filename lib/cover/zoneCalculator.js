/**
 * TwinkleTale AI — Cover Zone Geometry Calculator
 * Computes deterministic bounding boxes and safe zones for cover compositions.
 * Enforces:
 *  - 60-65% hero character spotlight zone
 *  - Upper uncluttered title breathing zone (25-30%)
 *  - Discrete editorial publisher footer zone (5-8%)
 *  - Scale invariance for preview (600x800) and high-res print (1200x1600)
 */

function calculateCoverZones(canvasWidth = 600, canvasHeight = 800) {
    const W = canvasWidth;
    const H = canvasHeight;

    // Relative vertical splits
    // Title Zone: Y: ~5.5% to ~28% (~22.5% of height)
    // Hero Zone: Y: ~27% to ~91% (~64% of height, giving 60-65% visual weight)
    // Footer Zone: Y: ~92% to ~97.5% (~5.5% of height)

    const topMargin = Math.round(H * 0.045);     // 36px @ 800
    const bottomMargin = Math.round(H * 0.035);  // 28px @ 800
    const sideMargin = Math.round(W * 0.06);     // 36px @ 600

    const titleTop = topMargin + Math.round(H * 0.01); // ~44px @ 800
    const titleHeight = Math.round(H * 0.22);          // ~176px @ 800 (Y: 44 to 220)
    const titleWidth = W - (sideMargin * 2);           // ~528px @ 600

    const heroTop = titleTop + titleHeight;            // ~220px @ 800
    const heroHeight = Math.round(H * 0.65);           // ~520px @ 800 (Y: 220 to 740)
    const heroWidth = Math.round(W - (sideMargin * 1.2)); // ~557px @ 600

    const footerTop = heroTop + heroHeight + Math.round(H * 0.005); // ~744px @ 800
    const footerHeight = H - footerTop - bottomMargin;             // ~28px @ 800
    const footerWidth = W - (sideMargin * 2);

    const totalCanvasArea = W * H;
    const heroArea = heroWidth * heroHeight;
    const heroAreaRatio = Math.round((heroArea / totalCanvasArea) * 100) / 100;

    return {
        canvas: {
            width: W,
            height: H,
            aspectRatio: W / H,
            totalArea: totalCanvasArea
        },
        margins: {
            top: topMargin,
            bottom: bottomMargin,
            left: sideMargin,
            right: sideMargin
        },
        titleZone: {
            x: sideMargin,
            y: titleTop,
            width: titleWidth,
            height: titleHeight,
            centerX: Math.round(W / 2),
            bottomY: titleTop + titleHeight
        },
        heroZone: {
            x: Math.round((W - heroWidth) / 2),
            y: heroTop,
            width: heroWidth,
            height: heroHeight,
            centerX: Math.round(W / 2),
            centerY: Math.round(heroTop + (heroHeight / 2)),
            areaRatio: heroAreaRatio, // Target ~0.60 - 0.65
            description: 'Spotlight zone commanding 60-65% of the cover area for the child character'
        },
        footerZone: {
            x: sideMargin,
            y: footerTop,
            width: footerWidth,
            height: footerHeight,
            centerX: Math.round(W / 2)
        },
        scrim: {
            // Gradient scrim parameters for title readability
            startY: 0,
            endY: Math.round(H * 0.35),
            startOpacity: 0.70,
            endOpacity: 0.0
        }
    };
}

module.exports = {
    calculateCoverZones
};
