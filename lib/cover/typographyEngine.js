/**
 * TwinkleTale AI — Modern Editorial Cover Typography Engine
 * Produces ultra-premium, readable SVG typography overlays for reimagined covers.
 * Features:
 *  - Multilingual support (Latin serif, Devanagari, Bengali, Tamil, Telugu, Arabic)
 *  - Self-contained base64 TTF embedding for zero-dependency rendering
 *  - Intelligent, balanced line wrapping for multi-word titles
 *  - Soft cinematic top gradient scrim for 100% legibility over any illustration
 *  - Discrete publisher footer imprint
 */

const fs = require('fs');
const path = require('path');
const { calculateCoverZones } = require('./zoneCalculator');

// Pre-load font base64 strings
const fontsFolder = path.join(__dirname, '..', '..', 'fonts');
const FONT_BASE64 = {};

try {
    const fontFiles = {
        hindi: 'NotoSansDevanagari-Regular.ttf',
        bengali: 'NotoSansBengali-Regular.ttf',
        tamil: 'NotoSansTamil-Regular.ttf',
        telugu: 'NotoSansTelugu-Regular.ttf',
        arabic: 'NotoSansArabic-Regular.ttf'
    };

    for (const [key, filename] of Object.entries(fontFiles)) {
        const fullPath = path.join(fontsFolder, filename);
        if (fs.existsSync(fullPath)) {
            FONT_BASE64[key] = fs.readFileSync(fullPath).toString('base64');
        }
    }
} catch (err) {
    console.warn('⚠️ [TypographyEngine] Font pre-cache warning:', err.message);
}

function escapeXml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function sanitizeIndicText(text) {
    if (!text) return '';
    return String(text)
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\u093C\u09BC\u0ABC\u0B3C]/g, '')
        .normalize('NFC')
        .trim();
}

function isNonLatin(str) {
    return /[\u0900-\u0DFF\u0600-\u06FF\u4E00-\u9FFF]/.test(String(str || ''));
}

function getSvgFontFaceStyle(lang = 'en', textSample = '') {
    const l = String(lang || '').toLowerCase();
    let fontFace = '';

    if (FONT_BASE64.hindi && (l.includes('hindi') || /[\u0900-\u097F]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'CoverIndicFont'; src: url('data:font/ttf;base64,${FONT_BASE64.hindi}') format('truetype'); font-weight: 700; }\n`;
    } else if (FONT_BASE64.bengali && (l.includes('bengali') || l.includes('bangla') || /[\u0980-\u09FF]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'CoverIndicFont'; src: url('data:font/ttf;base64,${FONT_BASE64.bengali}') format('truetype'); font-weight: 700; }\n`;
    } else if (FONT_BASE64.tamil && (l.includes('tamil') || /[\u0B80-\u0BFF]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'CoverIndicFont'; src: url('data:font/ttf;base64,${FONT_BASE64.tamil}') format('truetype'); font-weight: 700; }\n`;
    } else if (FONT_BASE64.telugu && (l.includes('telugu') || /[\u0C00-\u0C7F]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'CoverIndicFont'; src: url('data:font/ttf;base64,${FONT_BASE64.telugu}') format('truetype'); font-weight: 700; }\n`;
    } else if (FONT_BASE64.arabic && (l.includes('arabic') || l.includes('urdu') || /[\u0600-\u06FF]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'CoverIndicFont'; src: url('data:font/ttf;base64,${FONT_BASE64.arabic}') format('truetype'); font-weight: 700; }\n`;
    }

    return fontFace ? `<style>\n${fontFace}\n</style>` : '';
}

/**
 * Break title into balanced lines for editorial presentation
 */
function wrapTitle(title, maxCharsPerLine = 22) {
    const clean = title.trim().replace(/\s+/g, ' ');
    if (clean.length <= maxCharsPerLine) {
        return [clean];
    }

    const words = clean.split(' ');
    if (words.length <= 1) {
        return [clean];
    }

    const mid = Math.ceil(words.length / 2);
    const line1 = words.slice(0, mid).join(' ');
    const line2 = words.slice(mid).join(' ');
    return [line1, line2];
}

/**
 * Generates an SVG typography overlay string
 */
function generateCoverTypographySvg({
    childName = 'Child',
    bookTitle = '',
    themeMaster = null,
    lang = 'en',
    width = 600,
    height = 800
}) {
    const zones = calculateCoverZones(width, height);
    const nonLatin = isNonLatin(childName + (bookTitle || ''));
    const fontFaceStyle = getSvgFontFaceStyle(lang, childName + (bookTitle || ''));

    const fontFamilies = nonLatin
        ? "'CoverIndicFont', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Arabic', 'Nirmala UI', sans-serif"
        : "'Playfair Display', Georgia, 'Times New Roman', serif";

    const sansFamilies = "'Montserrat', 'Helvetica Neue', Arial, sans-serif";

    const accentColor = themeMaster?.palette?.accent || '#f6d365';
    const primaryTitle = (bookTitle && bookTitle.trim()) || `${childName}'s Adventure`;
    const cleanTitle = sanitizeIndicText(primaryTitle);
    const cleanChildName = sanitizeIndicText(childName);

    // Kicker / Top Byline
    let kickerText = '';
    if (nonLatin) {
        kickerText = `${cleanChildName} की प्यारी कहानी`;
    } else {
        kickerText = `A  T W I N K L E T A L E  A D V E N T U R E  F O R  ${cleanChildName.toUpperCase()}`;
    }

    // Title Wrapping
    const maxChars = nonLatin ? 20 : 22;
    const titleLines = wrapTitle(cleanTitle, maxChars);

    // Calculate Y positions within Title Zone (Y: 44 to 220 in 800h canvas)
    const kickerY = zones.titleZone.y + Math.round(zones.canvas.height * 0.05); // ~84px
    let titleSvgLines = '';

    if (titleLines.length === 1) {
        const titleY = kickerY + Math.round(zones.canvas.height * 0.075); // ~144px
        const fontSize = nonLatin ? 32 : 36;
        titleSvgLines = `
            <text x="${zones.canvas.width / 2}" y="${titleY}" text-anchor="middle"
                  fill="#FFFFFF" font-family="${fontFamilies}" font-size="${fontSize}" font-weight="700"
                  filter="drop-shadow(0 3px 10px rgba(0,0,0,0.92)) drop-shadow(0 1px 3px rgba(0,0,0,0.85))">
                ${escapeXml(titleLines[0])}
            </text>
        `;
    } else {
        const line1Y = kickerY + Math.round(zones.canvas.height * 0.058); // ~130px
        const line2Y = line1Y + Math.round(zones.canvas.height * 0.052);  // ~172px
        const fontSize = nonLatin ? 28 : 31;
        titleSvgLines = `
            <text x="${zones.canvas.width / 2}" y="${line1Y}" text-anchor="middle"
                  fill="#FFFFFF" font-family="${fontFamilies}" font-size="${fontSize}" font-weight="700"
                  filter="drop-shadow(0 3px 10px rgba(0,0,0,0.92)) drop-shadow(0 1px 3px rgba(0,0,0,0.85))">
                ${escapeXml(titleLines[0])}
            </text>
            <text x="${zones.canvas.width / 2}" y="${line2Y}" text-anchor="middle"
                  fill="${accentColor}" font-family="${fontFamilies}" font-size="${fontSize}" font-weight="700"
                  filter="drop-shadow(0 3px 10px rgba(0,0,0,0.92)) drop-shadow(0 1px 3px rgba(0,0,0,0.85))">
                ${escapeXml(titleLines[1])}
            </text>
        `;
    }

    // Publisher Footer
    const footerY = zones.footerZone.y + Math.round(zones.footerZone.height * 0.65);
    const footerText = 'T W I N K L E T A L E   P U B L I S H I N G';

    return `
    <svg width="${zones.canvas.width}" height="${zones.canvas.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="editorialTopScrim" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#000000" stop-opacity="0.75"/>
                <stop offset="50%" stop-color="#000000" stop-opacity="0.45"/>
                <stop offset="85%" stop-color="#000000" stop-opacity="0.15"/>
                <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="editorialBottomScrim" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
                <stop offset="40%" stop-color="#000000" stop-opacity="0.25"/>
                <stop offset="100%" stop-color="#000000" stop-opacity="0.65"/>
            </linearGradient>
        </defs>

        ${fontFaceStyle}

        <!-- Top Negative Space Gradient Scrim (Guarantees Title Legibility) -->
        <rect x="0" y="0" width="${zones.canvas.width}" height="${zones.scrim.endY}" fill="url(#editorialTopScrim)"/>

        <!-- Bottom Footer Gradient Scrim -->
        <rect x="0" y="${zones.canvas.height - 110}" width="${zones.canvas.width}" height="110" fill="url(#editorialBottomScrim)"/>

        <!-- Top Byline / Kicker -->
        <text x="${zones.canvas.width / 2}" y="${kickerY}" text-anchor="middle"
              fill="${accentColor}" font-family="${nonLatin ? fontFamilies : sansFamilies}"
              font-size="${nonLatin ? 16 : 11}" font-weight="${nonLatin ? '600' : '700'}"
              letter-spacing="${nonLatin ? '0.5' : '2.5'}" opacity="0.95"
              filter="drop-shadow(0 2px 6px rgba(0,0,0,0.85))">
            ${escapeXml(kickerText)}
        </text>

        <!-- Main Book Title -->
        ${titleSvgLines}

        <!-- Publisher Footer Imprint -->
        <text x="${zones.canvas.width / 2}" y="${footerY}" text-anchor="middle"
              fill="#FFFFFF" font-family="${sansFamilies}" font-size="10" font-weight="600"
              letter-spacing="3.0" opacity="0.80"
              filter="drop-shadow(0 1px 4px rgba(0,0,0,0.9))">
            ${escapeXml(footerText)}
        </text>
    </svg>
    `.trim();
}

module.exports = {
    generateCoverTypographySvg,
    wrapTitle,
    escapeXml,
    sanitizeIndicText,
    isNonLatin
};
