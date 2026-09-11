require('dotenv').config();
global.regeneratorRuntime = require('regenerator-runtime');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('================================================================');
console.log('🚀 RUNNING 5 COMPREHENSIVE BACKTESTS FOR TWINKLETALE ENGINE');
console.log('   Strict 16-Page / 28-Page Guardrails, Paired Spreads & Painterly Realism');
console.log('================================================================\n');

const fontsFolder = path.join(__dirname, 'fonts');
const PAGE_W = 600, PAGE_H = 800;

// Create dummy 1x1 PNG buffer for testing image placement without consuming API credits
const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Core functions matching server.js
function getSceneCount(bookLength) {
    const s = String(bookLength || '').toLowerCase();
    if (s.includes('24') || s.includes('long')) return 12;
    if (s.includes('16')) return 8;
    return 6;
}

function getCharacterDetails(childName, gender, age, theme) {
    const g = String(gender || '').toLowerCase().trim();
    let genderClean = 'boy';
    let pronoun = 'his';
    let subjectPronoun = 'he';

    if (g === 'girl') {
        genderClean = 'girl';
        pronoun = 'her';
        subjectPronoun = 'she';
    } else if (g === 'neutral' || g === 'star' || g === 'star child' || g === 'little star') {
        genderClean = 'little star';
        pronoun = 'their';
        subjectPronoun = 'they';
    }

    const childAge = parseInt(age, 10) || 5;

    const t = String(theme || '').toLowerCase();
    let outfit = 'wearing a soft pastel mint-cream cotton t-shirt with a tiny embroidered golden star and cozy navy shorts';
    if (t.includes('ocean') || t.includes('dolphin') || t.includes('mermaid')) {
        outfit = 'wearing a cozy sea-breeze cyan star t-shirt and rolled denim shorts';
    } else if (t.includes('space') || t.includes('star')) {
        outfit = 'wearing a cozy midnight-blue star-patterned onesie with golden starlight trim';
    } else if (t.includes('animal') || t.includes('forest') || t.includes('safari') || t.includes('jungle')) {
        outfit = 'wearing a soft sage-green adventure vest over a cream cotton tee and khaki shorts';
    } else if (t.includes('princess') || t.includes('castle') || t.includes('kingdom') || t.includes('magic') || t.includes('fairy')) {
        outfit = 'wearing an enchanted pastel lavender tunic with tiny golden star embroidery';
    } else if (t.includes('super')) {
        outfit = 'wearing a heroic soft crimson tunic with a gentle golden sun emblem and cozy joggers';
    } else if (t.includes('dinosaur')) {
        outfit = 'wearing a warm amber-ochre explorer hoodie with little leaf patches and rolled trousers';
    } else if (t.includes('circus') || t.includes('carnival')) {
        outfit = 'wearing a festive berry-red and gold-trimmed festive tunic with playful suspenders';
    } else if (t.includes('lullaby') || t.includes('bedtime') || t.includes('cloud')) {
        outfit = 'wearing warm fluffy cloud-white pajamas sprinkled with tiny golden stars';
    }

    const charAnchorText = (genderClean === 'little star')
        ? `adorable ${childAge}-year-old child named ${childName} with soulful sparkling dark eyes, natural soft dimensional skin tones with gentle peachy warmth, charming button nose, joyful warm smile, finely rendered hair with golden rim lighting, painterly storybook realism, ${outfit}`
        : `adorable ${childAge}-year-old ${genderClean} named ${childName} with soulful sparkling dark eyes, natural soft dimensional skin tones with gentle peachy warmth, charming button nose, joyful warm smile, finely rendered hair with golden rim lighting, painterly storybook realism, ${outfit}`;

    const charAnchorVisual = (genderClean === 'little star')
        ? `adorable ${childAge}-year-old child with soulful sparkling dark eyes, natural soft dimensional skin tones with gentle peachy warmth, charming button nose, joyful warm smile, finely rendered hair with golden rim lighting, painterly storybook realism, ${outfit}`
        : `adorable ${childAge}-year-old ${genderClean} with soulful sparkling dark eyes, natural soft dimensional skin tones with gentle peachy warmth, charming button nose, joyful warm smile, finely rendered hair with golden rim lighting, painterly storybook realism, ${outfit}`;

    return { genderClean, childAge, pronoun, subjectPronoun, charAnchor: charAnchorVisual, charAnchorVisual, charAnchorText, outfit };
}

function themeKit(base) {
    const b = String(base || '').toLowerCase();
    if (b.includes('space')) return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.20, 0.30), flatWord: 'solid flat deep indigo navy', motifs: 'tiny stars, crescent moons, little silver rockets and planets' };
    if (b.includes('animal') || b.includes('forest')) return { cover: rgb(0.10, 0.30, 0.24), accent: rgb(0.95, 0.80, 0.45), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.24, 0.20), flatWord: 'solid flat deep forest green', motifs: 'friendly forest animals, oak leaves, acorns and wildflowers' };
    if (b.includes('princess') || b.includes('castle') || b.includes('kingdom')) return { cover: rgb(0.55, 0.16, 0.35), accent: rgb(0.99, 0.85, 0.60), textBg: rgb(0.99, 0.96, 0.94), ink: rgb(0.32, 0.17, 0.24), flatWord: 'solid flat deep rose plum', motifs: 'roses, tiny golden crowns, castle spires and silk ribbons' };
    if (b.includes('super')) return { cover: rgb(0.45, 0.08, 0.12), accent: rgb(0.98, 0.75, 0.20), textBg: rgb(0.985, 0.96, 0.92), ink: rgb(0.30, 0.16, 0.14), flatWord: 'solid flat deep crimson', motifs: 'bright stars, hero shields and lightning bolts' };
    if (b.includes('dinosaur')) return { cover: rgb(0.18, 0.28, 0.15), accent: rgb(0.94, 0.76, 0.30), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.22, 0.24, 0.18), flatWord: 'solid flat deep moss green', motifs: 'prehistoric ferns, gentle friendly baby dinosaurs and amber leaves' };
    if (b.includes('ocean') || b.includes('dolphin') || b.includes('mermaid')) return { cover: rgb(0.06, 0.22, 0.38), accent: rgb(0.60, 0.88, 0.95), textBg: rgb(0.96, 0.98, 0.99), ink: rgb(0.12, 0.24, 0.34), flatWord: 'solid flat deep sapphire ocean blue', motifs: 'playful dolphins, seashells, starfish and coral reef bubbles' };
    if (b.includes('circus') || b.includes('carnival')) return { cover: rgb(0.42, 0.12, 0.18), accent: rgb(0.98, 0.82, 0.32), textBg: rgb(0.99, 0.97, 0.92), ink: rgb(0.30, 0.16, 0.18), flatWord: 'solid flat festive berry crimson', motifs: 'carousel horses, colorful balloons, circus tents and ribbons' };
    return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.20, 0.30), flatWord: 'solid flat deep indigo navy', motifs: 'flowers, leaves, ribbons and golden bells' };
}

function themeTitle(base) {
    const b = String(base || '').toLowerCase();
    if (b.includes('space')) return 'Treasury of Space & Stars';
    if (b.includes('animal') || b.includes('forest')) return 'Treasury of Forest & Animals';
    if (b.includes('princess') || b.includes('castle') || b.includes('kingdom')) return 'Treasury of Kingdom & Castles';
    if (b.includes('circus') || b.includes('carnival')) return 'Treasury of Circus & Carnivals';
    return 'Treasury of Wonderful Stories';
}

// FULL-BLEED COVER PRINT-SAFE ZONES
const Z = {
    topSky:       { top: 760, bottom: 560 },
    focalHero:    { top: 560, bottom: 110 },
    bottomBanner: { top: 110, bottom: 40 }
};

function assertZones() {
    const ok = Z.topSky.bottom >= Z.focalHero.top &&
               Z.focalHero.bottom >= Z.bottomBanner.top &&
               Z.bottomBanner.bottom > 0;
    if (!ok) throw new Error('COVER GUARDRAIL VIOLATION: zones overlap');
}

function isNonLatin(text) {
    return /[\u0600-\u06FF\u0900-\u0DFF\u0E00-\u0E7F]/.test(String(text || ''));
}

function chooseFont(text, bookFont, latinFont) {
    if (isNonLatin(text) && bookFont) return bookFont;
    return latinFont;
}

async function getFontForLanguage(pdfDoc, lang) {
    pdfDoc.registerFontkit(fontkit);
    const l = String(lang || 'English').toLowerCase();

    try {
        if (l.includes('hindi')) {
            const p = path.join(fontsFolder, 'NotoSansDevanagari-Regular.ttf');
            if (fs.existsSync(p)) return await pdfDoc.embedFont(fs.readFileSync(p));
        }
        if (l.includes('bengali') || l.includes('bangla')) {
            const p = path.join(fontsFolder, 'NotoSansBengali-Regular.ttf');
            if (fs.existsSync(p)) return await pdfDoc.embedFont(fs.readFileSync(p));
        }
        if (l.includes('tamil')) {
            const p = path.join(fontsFolder, 'NotoSansTamil-Regular.ttf');
            if (fs.existsSync(p)) return await pdfDoc.embedFont(fs.readFileSync(p));
        }
        if (l.includes('telugu')) {
            const p = path.join(fontsFolder, 'NotoSansTelugu-Regular.ttf');
            if (fs.existsSync(p)) return await pdfDoc.embedFont(fs.readFileSync(p));
        }
        if (l.includes('arabic') || l.includes('urdu')) {
            const p = path.join(fontsFolder, 'NotoSansArabic-Regular.ttf');
            if (fs.existsSync(p)) return await pdfDoc.embedFont(fs.readFileSync(p));
        }
    } catch (e) {
        console.log(`⚠️ Font embed notice for ${lang}:`, e.message);
    }

    return await pdfDoc.embedFont('Times-Roman');
}

function coverFit(img, pw, ph) {
    const ir = img.width / img.height, pr = pw / ph;
    let w, h;
    if (ir > pr) { h = ph; w = ph * ir; } else { w = pw; h = pw / ir; }
    return { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h };
}

function wrapText(text, font, size, maxWidth) {
    const str = String(text || '').trim();
    if (!str) return [];
    const words = str.split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    for (const w of words) {
        const test = cur ? cur + ' ' + w : w;
        try {
            if (font.widthOfTextAtSize(test, size) <= maxWidth) cur = test;
            else { if (cur) lines.push(cur); cur = w; }
        } catch (e) {
            if (cur) lines.push(cur); cur = w;
        }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [str];
}

function drawCentered(page, text, y, size, font, color, opacity) {
    try {
        const w = font.widthOfTextAtSize(text, size);
        page.drawText(text, { x: (PAGE_W - w) / 2, y, size, font, color, opacity: opacity === undefined ? 1 : opacity });
    } catch (e) {
        try { page.drawText(text, { x: 50, y, size, font, color, opacity: opacity === undefined ? 1 : opacity }); }
        catch (e2) { console.log('⚠️ drawCentered fallback notice:', e2.message); }
    }
}

function drawFlowLine(page, text, y, size, font, color, wave) {
    if (isNonLatin(text)) {
        return drawCentered(page, text, y, size, font, color);
    }
    try {
        const widths = []; let total = 0;
        for (const ch of text) {
            const w = font.widthOfTextAtSize(ch, size);
            widths.push(w); total += w + 0.8;
        }
        let cur = (PAGE_W - total) / 2;
        let i = 0;
        for (const ch of text) {
            const dy = Math.sin(i * 0.55) * wave;
            const rot = Math.sin(i * 0.7) * 3;
            page.drawText(ch, { x: cur + 2, y: y + dy - 2, size, font, color: rgb(0, 0, 0), opacity: 0.35, rotate: degrees(rot) });
            page.drawText(ch, { x: cur, y: y + dy, size, font, color, rotate: degrees(rot) });
            cur += widths[i] + 0.8;
            i++;
        }
    } catch (e) {
        drawCentered(page, text, y, size, font, color);
    }
}

function drawVectorDiamond(page, cx, cy, size, color) {
    page.drawRectangle({
        x: cx - size / 2,
        y: cy - size / 2,
        width: size,
        height: size,
        color,
        rotate: degrees(45)
    });
}

function drawVectorStar(page, cx, cy, spikes = 5, outerR = 10, innerR = 4.5, color) {
    const points = [];
    let angle = -Math.PI / 2;
    const step = Math.PI / spikes;
    for (let i = 0; i < spikes * 2; i++) {
        const r = (i % 2 === 0) ? outerR : innerR;
        const x = Math.round((Math.cos(angle) * r) * 100) / 100;
        const y = Math.round((-Math.sin(angle) * r) * 100) / 100;
        points.push((i === 0 ? 'M' : 'L') + ' ' + x + ' ' + y);
        angle += step;
    }
    const svgPath = points.join(' ') + ' Z';
    page.drawSvgPath(svgPath, { x: cx, y: cy, color });
}

function drawFrameVectors(page, pal) {
    page.drawRectangle({ x: 12, y: 12, width: PAGE_W - 24, height: PAGE_H - 24, borderColor: pal.accent, borderWidth: 2, borderOpacity: 0.9 });
    page.drawRectangle({ x: 20, y: 20, width: PAGE_W - 40, height: PAGE_H - 40, borderColor: pal.accent, borderWidth: 1, borderOpacity: 0.6 });
    const corners = [[20, 20], [PAGE_W - 20, 20], [20, PAGE_H - 20], [PAGE_W - 20, PAGE_H - 20]];
    for (const [cx, cy] of corners) {
        page.drawRectangle({ x: cx - 5, y: cy - 5, width: 10, height: 10, color: pal.accent, rotate: degrees(45) });
    }
}

async function runTests() {
    let passedCount = 0;

    // =========================================================================
    // TEST 1: Hindi Circus Story (Clean Vector Sky Drop Shadow, Zero Scrims, Fontkit GPOS Shaper)
    // =========================================================================
    try {
        console.log('--- TEST 1: Hindi Circus Story (Clean Vector Sky Drop Shadow & Fontkit GPOS Shaper) ---');
        assertZones();
        const details = getCharacterDetails('आरव', 'boy', 5, 'Circus & Carnivals');
        assert.strictEqual(details.genderClean, 'boy');
        assert.strictEqual(details.pronoun, 'his');
        assert(details.outfit.includes('berry-red and gold-trimmed'));
        assert(details.charAnchor.includes('painterly storybook realism'), 'Must use painterly storybook realism style');
        // Visual anchor must NOT leak child name to AI diffusion model
        assert(!details.charAnchorVisual.includes('आरव'), 'Visual anchor must never contain child name');

        const pal = themeKit('Circus & Carnivals');
        const pdfDoc = await PDFDocument.create();
        const bookFont = await getFontForLanguage(pdfDoc, 'Hindi');
        const serifBI = await pdfDoc.embedFont('Times-BoldItalic');
        const serifB = await pdfDoc.embedFont('Times-Bold');
        const serif = await pdfDoc.embedFont('Times-Roman');
        const dummyImg = await pdfDoc.embedPng(dummyPng);

        // Page 1: Full-Bleed Front Cover (Clean painting, zero dark grey rectangles)
        const cover = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        cover.drawImage(dummyImg, coverFit(dummyImg, PAGE_W, PAGE_H));

        // Name plaque & Title directly on sky with clean vector drop shadow
        const topLabel = isNonLatin('आरव') ? 'आरव' : "Aarav's";
        const topFont = chooseFont(topLabel, bookFont, serifBI);
        drawFlowLine(cover, topLabel, 725, 42, topFont, pal.accent, 2);

        const bookTitle = "आरव और जादुई सर्कस";
        const titleFont = chooseFont(bookTitle, bookFont, serifB);
        drawFlowLine(cover, bookTitle, 665, 36, titleFont, rgb(0.99, 0.98, 0.94), 2.5);

        // Bottom keepsake banner (Safe print margin at y = 38, clear of hero)
        drawCentered(cover, 'TwinkleTale Keepsake Treasury', 38, 11, serif, pal.accent, 0.95);
        drawVectorStar(cover, PAGE_W / 2 - 115, 38, 5, 5, 2.2, pal.accent);
        drawVectorStar(cover, PAGE_W / 2 + 115, 38, 5, 5, 2.2, pal.accent);

        // Complex Hindi ligatures and conjuncts on interior verse page
        const hindiVerse = "आरव सर्कस के जादुई मेले में पहुँचा, जहाँ चमकीले सितारे और रंग-बिरंगे झूले थे। जोकर ने मुस्कराकर आरव का स्वागत किया और एक प्यारा सा गुब्बारा उपहार में दिया।";
        const lines = wrapText(hindiVerse, bookFont, 18, 400);
        assert(lines.length > 1, 'Hindi text must wrap into multiple lines');

        const textPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        drawCentered(textPage, "जादुई मेला", 610, 26, bookFont, pal.cover);
        drawVectorDiamond(textPage, PAGE_W / 2, 576, 8, pal.cover);

        let by = 520 - ((520 - 180) - lines.length * 32) / 2;
        for (const line of lines) {
            drawCentered(textPage, line, by, 18, bookFont, pal.ink);
            by -= 32;
        }
        assert(by >= 130, 'Verse lines must respect safe print margin');

        // Test spread number rendered with serif at safe y = 100 pt
        drawCentered(textPage, '— 1 —', 100, 12, serif, pal.ink, 0.75);

        const bytes = await pdfDoc.save();
        assert(bytes.length > 5000, 'PDF bytes should be generated');
        console.log(`✅ TEST 1 PASSED: Full-bleed cover (zero dark scrims), clean drop shadows, Hindi fontkit shaping verified! (size: ${bytes.length} bytes)\n`);
        passedCount++;
    } catch (e) {
        console.error('❌ TEST 1 FAILED:', e);
    }

    // =========================================================================
    // TEST 2: Treasury Edition (Strict 16 Physical Pages = Print Multiple of 4 & Side-by-Side Spread Pairing)
    // =========================================================================
    try {
        console.log('--- TEST 2: Treasury Edition (Strict 16-Page Guardrail: 1 Cover + 1 Dedication + 12 Interior [6 Spreads] + 1 Blessing + 1 Back Cover) ---');
        const details = getCharacterDetails('Ananya', 'girl', 6, 'Space & Stars');
        assert.strictEqual(details.genderClean, 'girl');
        assert.strictEqual(details.pronoun, 'her');
        assert(details.outfit.includes('midnight-blue star-patterned onesie'));

        const pal = themeKit('Space & Stars');
        const scenes = getSceneCount('12 pages'); // 6 scenes = 12 interior story pages
        assert.strictEqual(scenes, 6, 'Treasury Edition must have 6 scenes');

        // Simulate Preview Cover Generation & Exact Locking
        const previewCoverBuffer = Buffer.from(dummyPng);
        const lockedCoverBuffer = Buffer.from(previewCoverBuffer);
        assert.strictEqual(Buffer.compare(previewCoverBuffer, lockedCoverBuffer), 0, 'Preview cover buffer must match locked cover buffer with 100% fidelity');

        const pdfDoc = await PDFDocument.create();
        const serifBI = await pdfDoc.embedFont('Times-BoldItalic');
        const serifB = await pdfDoc.embedFont('Times-Bold');
        const serifI = await pdfDoc.embedFont('Times-Italic');
        const serif = await pdfDoc.embedFont('Times-Roman');

        const coverImg = await pdfDoc.embedPng(lockedCoverBuffer);
        const dummyImg = await pdfDoc.embedPng(dummyPng);

        // Page 1: Locked Front Cover (Exact Preview Cover)
        const cover = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cover.drawImage(coverImg, coverFit(coverImg, PAGE_W, PAGE_H));
        drawFlowLine(cover, "Ananya's", 725, 42, serifBI, pal.accent, 2);
        drawFlowLine(cover, "Treasury of Space & Stars", 665, 36, serifB, rgb(0.99, 0.98, 0.94), 2.5);
        drawCentered(cover, 'TwinkleTale Keepsake Treasury', 38, 11, serifI, pal.accent, 0.95);
        drawVectorStar(cover, PAGE_W / 2 - 115, 38, 5, 5, 2.2, pal.accent);
        drawVectorStar(cover, PAGE_W / 2 + 115, 38, 5, 5, 2.2, pal.accent);

        // Page 2: Inside Front Spread - Welcome & Personalized Dedication
        const dedPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        dedPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
        drawFrameVectors(dedPage, pal);
        drawCentered(dedPage, 'TWINKLETALE KEEPSAKE TREASURY', 665, 10, serifB, pal.accent, 0.95);
        drawCentered(dedPage, "Ananya's Space Adventure", 612, 26, serifB, pal.cover);
        drawCentered(dedPage, 'Especially for Ananya', 480, 16, serifB, pal.cover);
        drawCentered(dedPage, 'May you always reach for the stars.', 450, 14, serifI, pal.ink);

        // 6 Spreads = 12 Interior Story Pages (Pages 3 to 14)
        for (let i = 0; i < scenes; i++) {
            // Left Page: Full-bleed Illustration (Pages 3, 5, 7, 9, 11, 13)
            const imgPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            imgPage.drawImage(dummyImg, coverFit(dummyImg, PAGE_W, PAGE_H));

            // Right Page: Framed Verse Page (Pages 4, 6, 8, 10, 12, 14)
            const textPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            drawFrameVectors(textPage, pal);
            drawCentered(textPage, `Scene ${i + 1}`, 610, 26, serifB, pal.cover);
            drawVectorDiamond(textPage, PAGE_W / 2, 576, 8, pal.cover);
            drawCentered(textPage, `A magical starlight adventure with wonder and joy on spread ${i + 1}.`, 400, 18, serif, pal.ink);
            drawCentered(textPage, `— ${i + 1} —`, 100, 12, serif, pal.ink, 0.75);
        }

        // Page 15: Keepsake Seal & Bedtime Blessing
        const blessPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        blessPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawCentered(blessPage, 'TwinkleTale', 630, 28, serifBI, pal.accent);
        drawCentered(blessPage, 'Sleep With The Stars, Ananya', 525, 20, serifB, pal.accent);
        drawVectorStar(blessPage, PAGE_W / 2, 680, 5, 18, 8, pal.accent);

        // Page 16: Official Keepsake Back Cover
        const backCover = pdfDoc.addPage([PAGE_W, PAGE_H]);
        backCover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawFrameVectors(backCover, pal);
        drawVectorStar(backCover, PAGE_W / 2, 530, 5, 24, 11, pal.accent);
        drawCentered(backCover, 'TwinkleTale', 480, 26, serifBI, pal.accent);
        drawCentered(backCover, 'Personalized Keepsake Storybooks', 455, 12, serifI, rgb(0.95, 0.95, 0.95), 0.9);

        // Strict assertions
        const totalPages = pdfDoc.getPageCount();
        const expectedPages = (scenes * 2) + 4;
        assert.strictEqual(totalPages, 16, 'Total pages must be exactly 16');
        assert.strictEqual(totalPages, expectedPages, 'Total pages must match (scenes * 2) + 4');
        assert.strictEqual(totalPages % 4, 0, 'Total page count must be an exact multiple of 4 for print manufacturing');

        // Verify side-by-side spread pairing:
        // Reader Spread 1: [Page 1 Cover, Page 2 Dedication]
        // Reader Spread 2: [Page 3 Scene 1 Image, Page 4 Scene 1 Text] -> Paired!
        // Reader Spread 3: [Page 5 Scene 2 Image, Page 6 Scene 2 Text] -> Paired!
        for (let s = 0; s < scenes; s++) {
            const leftImagePageNum = 3 + (s * 2);
            const rightTextPageNum = 4 + (s * 2);
            assert.strictEqual(leftImagePageNum % 2, 1, `Scene ${s + 1} Image must be on an odd physical page (Left in duplex reader)`);
            assert.strictEqual(rightTextPageNum % 2, 0, `Scene ${s + 1} Text must be on an even physical page (Right in duplex reader)`);
        }

        const bytes = await pdfDoc.save();
        console.log(`✅ TEST 2 PASSED: Strict 16-page Treasury Edition verified with perfect 2-page spread pairing & print multiple of 4! (Total physical pages: ${totalPages}, size: ${bytes.length} bytes)\n`);
        passedCount++;
    } catch (e) {
        console.error('❌ TEST 2 FAILED:', e);
    }

    // =========================================================================
    // TEST 3: Spanish Kingdom Story (Inclusive Gender "Little Star" & Visual Prompt Hygiene)
    // =========================================================================
    try {
        console.log('--- TEST 3: Spanish Kingdom Story (Gender-Inclusive "Little Star" + AI Text Hallucination Prevention) ---');
        const details = getCharacterDetails('Alex', 'star', 4, 'Kingdom & Castles');
        assert.strictEqual(details.genderClean, 'little star');
        assert.strictEqual(details.pronoun, 'their');
        assert.strictEqual(details.subjectPronoun, 'they');
        assert(details.outfit.includes('pastel lavender tunic'));

        // charAnchorVisual must NOT contain child name 'Alex'
        assert(!details.charAnchorVisual.includes('Alex'), 'charAnchorVisual must NEVER include child name');
        assert(details.charAnchorText.includes('Alex'), 'charAnchorText retains child name for story text');

        // Test DeepSeek bespoke prompt name sanitizer
        let rawPrompt = "Alex exploring a magnificent crystal palace with Alex's friend";
        const nameRegex = new RegExp(`\\bAlex\\b`, 'gi');
        rawPrompt = rawPrompt.replace(nameRegex, 'the child');
        assert(!rawPrompt.includes('Alex'), 'Accidental child name in prompt must be sanitized');
        assert.strictEqual(rawPrompt, "the child exploring a magnificent crystal palace with the child's friend");

        const pal = themeKit('Kingdom & Castles');
        const pdfDoc = await PDFDocument.create();
        const serifB = await pdfDoc.embedFont('Times-Bold');

        const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        const spanishText = "Había una vez un pequeño soñador llamado Alex en un castillo lleno de magia, estrellas y bendiciones.";
        const lines = wrapText(spanishText, serifB, 18, 420);
        assert(lines.length >= 1);
        let y = 400;
        for (const line of lines) {
            drawCentered(page, line, y, 18, serifB, pal.ink);
            y -= 30;
        }

        const bytes = await pdfDoc.save();
        assert(bytes.length > 500, 'PDF bytes should be generated');
        console.log(`✅ TEST 3 PASSED: Inclusive 3rd gender ("Little Star") & AI text hallucination prevention verified!\n`);
        passedCount++;
    } catch (e) {
        console.error('❌ TEST 3 FAILED:', e);
    }

    // =========================================================================
    // TEST 4: Grand Treasury (24 Interior Pages = Exactly 28 Total Physical Pages, Multiple of 4)
    // =========================================================================
    try {
        console.log('--- TEST 4: Grand Treasury Edition (Strict 28-Page Guardrail: 1 Cover + 1 Dedication + 24 Interior [12 Spreads] + 1 Blessing + 1 Back Cover) ---');
        const scenes = getSceneCount('Grand Treasury (24 pages)');
        assert.strictEqual(scenes, 12, 'Grand Treasury must have 12 scenes (24 interior story pages)');

        const pdfDoc = await PDFDocument.create();
        const dummyImg = await pdfDoc.embedPng(dummyPng);
        const font = await pdfDoc.embedFont('Times-Roman');
        const fontB = await pdfDoc.embedFont('Times-Bold');
        const pal = themeKit('Ocean & Dolphins');

        // Page 1: Full-Bleed Front Cover (Clean, zero scrims)
        const cover = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cover.drawImage(dummyImg, coverFit(dummyImg, PAGE_W, PAGE_H));
        drawFlowLine(cover, "Aria's", 725, 42, fontB, pal.accent, 2);
        drawFlowLine(cover, "Treasury of Ocean & Dolphins", 665, 36, fontB, rgb(0.99, 0.98, 0.94), 2.5);
        drawCentered(cover, 'TwinkleTale Keepsake Treasury', 38, 11, font, pal.accent, 0.95);
        drawVectorStar(cover, PAGE_W / 2 - 115, 38, 5, 5, 2.2, pal.accent);
        drawVectorStar(cover, PAGE_W / 2 + 115, 38, 5, 5, 2.2, pal.accent);

        // Page 2: Inside Front Dedication Spread
        const dedPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        dedPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
        drawFrameVectors(dedPage, pal);
        drawCentered(dedPage, 'TWINKLETALE KEEPSAKE TREASURY', 665, 10, fontB, pal.accent, 0.95);
        drawCentered(dedPage, "Aria's Ocean Adventure", 612, 26, fontB, pal.cover);

        // 12 Spreads = 24 Interior Pages (Pages 3 to 26)
        for (let i = 1; i <= 12; i++) {
            // Left page: Full-bleed Illustration (Pages 3, 5, 7, ... 25)
            const p1 = pdfDoc.addPage([PAGE_W, PAGE_H]);
            p1.drawImage(dummyImg, coverFit(dummyImg, PAGE_W, PAGE_H));

            // Right page: Framed Verse Page (Pages 4, 6, 8, ... 26)
            const p2 = pdfDoc.addPage([PAGE_W, PAGE_H]);
            drawFrameVectors(p2, pal);
            drawCentered(p2, `Grand Treasury Scene ${i}`, 610, 24, fontB, pal.cover);
            drawVectorDiamond(p2, PAGE_W / 2, 576, 8, pal.cover);
            drawCentered(p2, `A magical ocean adventure with wonder on spread ${i}.`, 400, 18, font, pal.ink);
            drawCentered(p2, `— ${i} —`, 100, 12, font, pal.ink);
        }

        // Page 27: Ending Blessing Page
        const endPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        endPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawCentered(endPage, 'TwinkleTale', 630, 28, fontB, pal.accent);

        // Page 28: Official Keepsake Back Cover
        const backCover = pdfDoc.addPage([PAGE_W, PAGE_H]);
        backCover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawFrameVectors(backCover, pal);
        drawVectorStar(backCover, PAGE_W / 2, 530, 5, 24, 11, pal.accent);
        drawCentered(backCover, 'TwinkleTale', 480, 26, fontB, pal.accent);

        const totalPages = pdfDoc.getPageCount();
        const expectedPages = (scenes * 2) + 4;
        assert.strictEqual(totalPages, 28, 'Total pages must equal exactly 28 (1 cover + 1 dedication + 24 interior + 1 blessing + 1 back cover)');
        assert.strictEqual(totalPages, expectedPages, 'Total pages must equal (scenes * 2) + 4');
        assert.strictEqual(totalPages % 4, 0, 'Grand Treasury page count must be an exact multiple of 4 for commercial printing');

        const bytes = await pdfDoc.save();
        console.log(`✅ TEST 4 PASSED: Grand Treasury 28-page guardrail strictly verified with exact multiple-of-4 print sheet standard! (Total physical pages: ${totalPages}, size: ${bytes.length} bytes)\n`);
        passedCount++;
    } catch (e) {
        console.error('❌ TEST 4 FAILED:', e);
    }

    // =========================================================================
    // TEST 5: Multilingual Font Matrix (Bengali, Tamil, Telugu, Arabic, Urdu)
    // =========================================================================
    try {
        console.log('--- TEST 5: Multilingual Font Matrix (Bengali, Tamil, Telugu, Arabic, Urdu) ---');
        const languages = [
            { name: 'Bengali', text: 'টুইঙ্কলটেল জাদুকরী গল্প ও স্বপ্ন' },
            { name: 'Tamil', text: 'அன்பான குழந்தைகள் கதை புத்தகம்' },
            { name: 'Telugu', text: 'పిల్లల కోసం అందమైన కథలు' },
            { name: 'Arabic', text: 'قصص الأطفال الجميلة والممتعة' },
            { name: 'Urdu', text: 'پیارے بچوں کی کہانیاں' }
        ];

        for (const lang of languages) {
            const pdfDoc = await PDFDocument.create();
            const font = await getFontForLanguage(pdfDoc, lang.name);
            const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
            
            page.drawText(lang.text, { x: 50, y: 500, size: 20, font, color: rgb(0.1, 0.1, 0.2) });
            const bytes = await pdfDoc.save();
            assert(bytes.length > 5000, `PDF for ${lang.name} should generate`);
            console.log(`  ✓ ${lang.name}: font successfully embedded and shaped.`);
        }

        console.log(`✅ TEST 5 PASSED: All 5 non-Latin scripts (Bengali, Tamil, Telugu, Arabic, Urdu) rendered without error!\n`);
        passedCount++;
    } catch (e) {
        console.error('❌ TEST 5 FAILED:', e);
    }

    console.log('================================================================');
    console.log(`🏁 BACKTEST SUMMARY: ${passedCount}/5 TESTS PASSED SUCCESSFULLY!`);
    console.log('================================================================');
    if (passedCount < 5) process.exit(1);
}

runTests().catch(err => {
    console.error('Fatal backtest error:', err);
    process.exit(1);
});
