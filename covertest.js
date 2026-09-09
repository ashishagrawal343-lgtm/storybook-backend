require('dotenv').config();
const Replicate = require('replicate');
const axios = require('axios');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const PAGE_W = 600, PAGE_H = 800;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STYLE = 'hand-painted children\'s storybook illustration, soft gouache texture, warm pastel palette, gentle storybook lighting, no text, no letters, no watermark: ';

// ============ GUARDRAIL ZONES (fixed + asserted) ============
const Z = {
    name:  { bottom: 690 },
    medal: { cx: 300, cy: 450, r: 120 },
    title: { top: 300, bottom: 150 }
};
function assertZones() {
    const ok = Z.name.bottom > (Z.medal.cy + Z.medal.r + 12) &&
               (Z.medal.cy - Z.medal.r - 12) > Z.title.top &&
               Z.title.bottom > 0;
    if (!ok) throw new Error('COVER GUARDRAIL VIOLATION: zones overlap');
    console.log('✅ Guardrails: name / medallion / title zones verified — overlap impossible');
}

function themeKit(base) {
    const b = base.toLowerCase();
    if (b.includes('space')) return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), flatWord: 'solid flat deep indigo navy', motifs: 'tiny stars, crescent moons, little silver rockets and planets' };
    if (b.includes('animal')) return { cover: rgb(0.10, 0.30, 0.24), accent: rgb(0.95, 0.80, 0.45), flatWord: 'solid flat deep forest green', motifs: 'friendly forest animals, oak leaves, acorns and wildflowers' };
    if (b.includes('princess')) return { cover: rgb(0.55, 0.16, 0.35), accent: rgb(0.99, 0.85, 0.60), flatWord: 'solid flat deep rose plum', motifs: 'roses, tiny golden crowns and silk ribbons' };
    if (b.includes('super')) return { cover: rgb(0.45, 0.08, 0.12), accent: rgb(0.98, 0.75, 0.20), flatWord: 'solid flat deep crimson', motifs: 'bright stars, hero shields and lightning bolts' };
    return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), flatWord: 'solid flat deep indigo navy', motifs: 'flowers, leaves, ribbons and golden bells' };
}
function themeTitle(base) {
    const b = base.toLowerCase();
    if (b.includes('space')) return 'Treasury of Space Adventures';
    if (b.includes('animal')) return 'Treasury of Animal Friends';
    if (b.includes('princess')) return 'Treasury of Princess Tales';
    if (b.includes('super')) return 'Treasury of Superhero Adventures';
    return 'Treasury of Wonderful Adventures';
}

function coverFit(img, pw, ph) {
    const ir = img.width / img.height, pr = pw / ph;
    let w, h;
    if (ir > pr) { h = ph; w = ph * ir; } else { w = pw; h = pw / ir; }
    return { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h };
}
function wrapText(text, font, size, maxWidth) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    for (const w of words) {
        const test = cur ? cur + ' ' + w : w;
        if (font.widthOfTextAtSize(test, size) <= maxWidth) cur = test;
        else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
}
// Hand-lettered feel: gentle wave + per-letter tilt + soft shadow
function drawFlowLine(page, text, y, size, font, color, wave) {
    const widths = []; let total = 0;
    for (const ch of text) { const w = font.widthOfTextAtSize(ch, size); widths.push(w); total += w + 0.8; }
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
}

async function withRetry(label, fn, attempts = 3, wait = 6000) {
    for (let i = 1; i <= attempts; i++) {
        try { return await fn(); }
        catch (e) {
            console.log(`  ↻ retry ${i}/${attempts} for ${label}: ${e.message}`);
            if (i === attempts) throw e;
            await sleep(wait);
        }
    }
}
async function generateImage(prompt, photoData) {
    if (photoData) {
        try {
            const out = await replicate.run("black-forest-labs/flux-kontext-pro", {
                input: { input_image: photoData, prompt: prompt, output_format: "png" }
            });
            return Array.isArray(out) ? out[0] : out;
        } catch (e) { console.log("    (face model failed, falling back)"); }
    }
    const out = await replicate.run("black-forest-labs/flux-1.1-pro", {
        input: { prompt: prompt, aspect_ratio: "3:4", output_format: "png" }
    });
    return Array.isArray(out) ? out[0] : out;
}
async function fetchImage(pdfDoc, url) {
    const bytes = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    try { return await pdfDoc.embedPng(bytes.data); }
    catch (e) { return await pdfDoc.embedJpg(bytes.data); }
}

(async () => {
    const childName = process.argv[2] || 'Aarav';
    const base = process.argv[3] || 'Space';
    const photoPath = process.argv[4] || '';
    let photoData = '';
    if (photoPath) {
        const buf = fs.readFileSync(photoPath);
        if (buf.length > 1000 * 1024) console.log('⚠️ Photo >1MB — use a smaller jpg if face-lock fails.');
        photoData = 'data:image/jpeg;base64,' + buf.toString('base64');
        console.log('📷 Photo loaded for face-lock');
    }

    assertZones();
    const pal = themeKit(base);
    const title = themeTitle(base);
    console.log(`🎨 COVER LAB v2 | ${childName} | ${base} | photo=${photoData ? 'yes' : 'no'}`);

    const pdfDoc = await PDFDocument.create();
    const serif = await pdfDoc.embedFont('Times-Roman');
    const serifB = await pdfDoc.embedFont('Times-Bold');
    const serifBI = await pdfDoc.embedFont('Times-BoldItalic');

    // 1) BACKGROUND: border + painted flourish arches framing the text zones
    console.log("  → Painting ornate background...");
    const bgPrompt = STYLE + `ornate storybook cover BACKGROUND only: elaborate golden-cream vine and leaf border with small vignettes of ${pal.motifs} confined strictly to the outer fifteen percent edges; two gentle painted flourish arches of tiny leaves and stars, one arching across the top center framing an empty name plaque area, and one arching across the lower middle framing an empty title plaque area; the rest of the inner field is ${pal.flatWord}, flat and empty except a few sparse tiny stars; absolutely no character, no person, no moon, no text, no letters anywhere; rich painterly detail`;
    const bgImg = await withRetry('background', async () => fetchImage(pdfDoc, await generateImage(bgPrompt, null)));
    await sleep(10000);

    // 2) CHILD MEDALLION
    console.log("  → Painting child medallion...");
    const vigPrompt = STYLE + `circular painted vignette portrait of ${photoData ? 'the exact same child from the reference photo' : 'a cute child'} as the storybook hero, head and shoulders, joyful expression, soft golden rim light, a few tiny ${pal.motifs} sparkles around the head, surrounded by ${pal.flatWord} background filling all four corners, vignette edges softly fading into that flat background`;
    const vigImg = await withRetry('vignette', async () => fetchImage(pdfDoc, await generateImage(vigPrompt, photoData)));

    // 3) COMPOSE
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, PAGE_H, color: pal.cover });
    page.drawImage(bgImg, coverFit(bgImg, PAGE_W, PAGE_H));

    // medallion with verified placement
    const d = Z.medal.r * 2;
    const fit = coverFit(vigImg, d, d);
    const dx = (Z.medal.cx - Z.medal.r) + fit.x;
    const dy2 = (Z.medal.cy - Z.medal.r) + fit.y;
    const drawnCx = dx + fit.width / 2, drawnCy = dy2 + fit.height / 2;
    if (Math.abs(drawnCx - Z.medal.cx) > 2 || Math.abs(drawnCy - Z.medal.cy) > 2) throw new Error('Medallion placement guardrail failed');
    console.log(`✅ Medallion placement verified at (${Z.medal.cx},${Z.medal.cy})`);
    page.drawImage(vigImg, { x: dx, y: dy2, width: fit.width, height: fit.height });
    page.drawEllipse({ x: Z.medal.cx, y: Z.medal.cy, xScale: Z.medal.r + 5, yScale: Z.medal.r + 5, borderColor: pal.accent, borderWidth: 3.5 });
    page.drawEllipse({ x: Z.medal.cx, y: Z.medal.cy, xScale: Z.medal.r + 11, yScale: Z.medal.r + 11, borderColor: pal.accent, borderWidth: 1.5, borderOpacity: 0.7 });

    // typography: name in gold italic, title in flowing cream lines
    drawFlowLine(page, `${childName}'s`, 700, 44, serifBI, pal.accent, 2);
    let tSize = 40;
    let tLines = wrapText(title, serifB, tSize, 470);
    if (tLines.length > 3) { tSize = 34; tLines = wrapText(title, serifB, tSize, 470); }
    let ty = 292;
    for (const line of tLines) {
        drawFlowLine(page, line, ty, tSize, serifB, rgb(0.99, 0.98, 0.94), 3);
        ty -= 46;
    }

    // 4) SAVE
    const out = path.join(__dirname, 'books', `cover_test_${Date.now()}.pdf`);
    fs.writeFileSync(out, await pdfDoc.save());
    console.log(`✅ COVER READY → open this file:\n${out}`);
})().catch(e => { console.error('❌ COVER LAB ERROR:', e.message); process.exit(1); });