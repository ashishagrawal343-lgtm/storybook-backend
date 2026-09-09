require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Replicate = require('replicate');
const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '15mb' }));
app.use(cors());

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const booksFolder = path.join(__dirname, 'books');
if (!fs.existsSync(booksFolder)) fs.mkdirSync(booksFolder);

const PAGE_W = 600, PAGE_H = 800;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STYLE = 'hand-painted children\'s storybook illustration, soft gouache texture, warm pastel palette, gentle storybook lighting, cohesive series style, no text, no letters, no watermark: ';

// ---- ROBUSTNESS: retry wrapper ----
async function withRetry(label, fn, attempts = 2, wait = 5000) {
    for (let i = 1; i <= attempts; i++) {
        try { return await fn(); }
        catch (e) {
            console.log(`  ↻ retry ${i}/${attempts} for ${label}: ${e.message}`);
            if (i === attempts) throw e;
            await sleep(wait);
        }
    }
}

// ---- ROBUSTNESS: simple per-IP rate limit (3 books/min) ----
const hits = new Map();
function rateLimiter(req, res, next) {
    const ip = req.ip; const now = Date.now();
    const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
    if (arr.length >= 3) return res.status(429).json({ success: false, error: 'Too many books at once. Please wait a minute and try again.' });
    arr.push(now); hits.set(ip, arr);
    next();
}

// ---- DESIGN: theme palettes (original, inspired by premium keepsake books) ----
function paletteFor(base) {
    const b = base.toLowerCase();
    if (b.includes('space')) return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.16, 0.16, 0.28) };
    if (b.includes('animal')) return { cover: rgb(0.10, 0.30, 0.24), accent: rgb(0.95, 0.80, 0.45), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.18, 0.22, 0.18) };
    if (b.includes('princess')) return { cover: rgb(0.55, 0.16, 0.35), accent: rgb(0.99, 0.85, 0.60), textBg: rgb(0.99, 0.96, 0.94), ink: rgb(0.30, 0.15, 0.22) };
    if (b.includes('super')) return { cover: rgb(0.45, 0.08, 0.12), accent: rgb(0.98, 0.75, 0.20), textBg: rgb(0.985, 0.96, 0.92), ink: rgb(0.28, 0.14, 0.12) };
    return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.16, 0.16, 0.28) };
}
function themeTitle(base) {
    const b = base.toLowerCase();
    if (b.includes('space')) return 'Treasury of Space Adventures';
    if (b.includes('animal')) return 'Treasury of Animal Friends';
    if (b.includes('princess')) return 'Treasury of Princess Tales';
    if (b.includes('super')) return 'Treasury of Superhero Adventures';
    return 'Treasury of Wonderful Adventures';
}

// ---- LAYOUT HELPERS ----
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
function drawCentered(page, text, y, size, font, color) {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (PAGE_W - w) / 2, y, size, font, color });
}
function drawFrame(page, pal) {
    page.drawRectangle({ x: 14, y: 14, width: PAGE_W - 28, height: PAGE_H - 28, borderColor: pal.accent, borderWidth: 2 });
    page.drawRectangle({ x: 24, y: 24, width: PAGE_W - 48, height: PAGE_H - 48, borderColor: pal.accent, borderWidth: 1 });
    const corners = [[24, 24], [PAGE_W - 24, 24], [24, PAGE_H - 24], [PAGE_W - 24, PAGE_H - 24]];
    for (const [cx, cy] of corners) {
        page.drawRectangle({ x: cx - 5, y: cy - 5, width: 10, height: 10, color: pal.accent, rotate: degrees(45) });
    }
}
function drawCrest(page, cx, cy, pal) {
    page.drawRectangle({ x: cx - 18, y: cy, width: 36, height: 7, color: pal.accent });
    page.drawRectangle({ x: cx - 14, y: cy + 10, width: 7, height: 7, color: pal.accent, rotate: degrees(45) });
    page.drawRectangle({ x: cx - 3.5, y: cy + 14, width: 7, height: 7, color: pal.accent, rotate: degrees(45) });
    page.drawRectangle({ x: cx + 7, y: cy + 10, width: 7, height: 7, color: pal.accent, rotate: degrees(45) });
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

app.post('/api/create-book', rateLimiter, async (req, res) => {
    const t0 = Date.now();
    try {
        const { childName, theme, photoData, bookLength, dedication } = req.body;
        const base = String(theme || 'Adventure').split(' (')[0];
        const scenes = (String(bookLength).toLowerCase().startsWith('long')) ? 8 : 4;
        const pal = paletteFor(base);
        const title = themeTitle(base);
        console.log(`📘 Book v3 | ${childName} | ${base} | scenes=${scenes} | photo=${photoData ? 'yes' : 'no'}`);

        // 1. STORY (validated)
        console.log("Step 1: Writing story...");
        const storyResponse = await withRetry('story', () => axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: `You are an award-winning children's book author. Output ONLY a valid JSON array of ${scenes} objects. No markdown, no extra text. Each object must have "scene_title" (2-4 words), "page_text" (35-50 words of warm read-aloud language for ages 3-8), and "image_prompt" (one sentence describing a single vivid scene for a hand-painted storybook illustration featuring the same child protagonist).` },
                { role: 'user', content: `Write a ${scenes}-scene story about a child named ${childName} going on a ${theme} adventure. Keep the same child character throughout.` }
            ]
        }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` } }), 2, 3000);

        let storyText = storyResponse.data.choices[0].message.content;
        storyText = storyText.replace(/```json/g, '').replace(/```/g, '').trim();
        const rawPages = JSON.parse(storyText);
        if (!Array.isArray(rawPages) || !rawPages.length) throw new Error('Story JSON invalid');
        const pages = rawPages.slice(0, scenes).map(p => ({
            scene_title: String(p.scene_title || `Scene`).slice(0, 60),
            page_text: String(p.page_text || '').slice(0, 700),
            image_prompt: String(p.image_prompt || 'a magical storybook scene').slice(0, 500)
        }));
        console.log("✅ Story validated!");

        // 2. BOOK BUILD
        console.log("Step 2: Building premium book...");
        const pdfDoc = await PDFDocument.create();
        pdfDoc.setTitle(`${childName}'s ${title}`);
        pdfDoc.setAuthor('Storybook Studio');
        pdfDoc.setSubject(`A personalized storybook for ${childName}`);
        pdfDoc.setCreator('Storybook Studio AI');

        const serif = await pdfDoc.embedFont(StandardFonts.TimesRoman);
        const serifB = await pdfDoc.embedFont(StandardFonts.TimesBold);
        const serifI = await pdfDoc.embedFont(StandardFonts.TimesItalic);
        const serifBI = await pdfDoc.embedFont(StandardFonts.TimesBoldItalic);
        let pageNo = 0;

        // ---- PAGE 1: COVER ----
        console.log("  → Cover...");
        const coverPrompt = STYLE + (photoData
            ? `circular vignette portrait of the exact same child from the reference photo as a storybook hero, ${base} theme, cozy magical background, centered composition, soft edges`
            : `circular vignette portrait of a cute child storybook hero, ${base} theme, cozy magical background, centered composition, soft edges`);
        const coverImg = await withRetry('cover image', async () => fetchImage(pdfDoc, await generateImage(coverPrompt, photoData)));

        const cover = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNo++;
        cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawFrame(cover, pal);
        drawCentered(cover, `${childName}'s`, 690, 34, serifBI, pal.accent);
        cover.drawRectangle({ x: 168, y: 378, width: 264, height: 264, color: pal.textBg });
        cover.drawRectangle({ x: 176, y: 386, width: 248, height: 248, borderColor: pal.accent, borderWidth: 2 });
        cover.drawImage(coverImg, { x: 180, y: 390, width: 240, height: 240, ...coverFit(coverImg, 240, 240) });
        let ty = 330;
        for (const line of wrapText(title, serifB, 38, 470)) {
            drawCentered(cover, line, ty, 38, serifB, rgb(0.99, 0.98, 0.94));
            ty -= 46;
        }
        drawCrest(cover, PAGE_W / 2, 120, pal);
        drawCentered(cover, 'A  PERSONALIZED  STORYBOOK', 92, 11, serif, pal.accent);

        // ---- PAGE 2: DEDICATION ----
        const ded = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNo++;
        ded.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
        drawFrame(ded, pal);
        ded.drawRectangle({ x: PAGE_W / 2 - 5, y: 640, width: 10, height: 10, color: pal.accent, rotate: degrees(45) });
        drawCentered(ded, `For ${childName},`, 560, 30, serifBI, pal.accent);
        let dy = 480;
        const dedText = (dedication && dedication.trim()) ? dedication.trim() : 'may this little story remind you, every single night, just how hugely loved you are.';
        for (const line of wrapText(dedText, serifI, 18, 420)) {
            drawCentered(ded, line, dy, 18, serifI, pal.ink);
            dy -= 30;
        }
        drawCentered(ded, `Printed just for you • ${new Date().getFullYear()}`, 80, 11, serif, pal.ink);

        // ---- SPREADS: image page + verse page ----
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            console.log(`  → Scene ${i + 1}/${pages.length}: ${page.scene_title}`);
            const scenePrompt = STYLE + (photoData
                ? `with the exact same child face as the reference photo: ${page.image_prompt}`
                : `${page.image_prompt}`);
            const pdfImage = await withRetry(`scene ${i + 1} image`, async () => fetchImage(pdfDoc, await generateImage(scenePrompt, photoData)));

            const imgPage = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNo++;
            imgPage.drawImage(pdfImage, coverFit(pdfImage, PAGE_W, PAGE_H));

            const textPage = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNo++;
            textPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
            drawFrame(textPage, pal);
            drawCentered(textPage, page.scene_title, 690, 24, serifB, pal.accent);
            textPage.drawRectangle({ x: PAGE_W / 2 - 4, y: 656, width: 8, height: 8, color: pal.accent, rotate: degrees(45) });
            let by = 600;
            for (const line of wrapText(page.page_text, serif, 17, 440)) {
                drawCentered(textPage, line, by, 17, serif, pal.ink);
                by -= 30;
            }
            drawCentered(textPage, String(pageNo), 42, 11, serif, pal.ink);

            if (i < pages.length - 1) {
                console.log("  ⏳ 10s pacing...");
                await sleep(10000);
            }
        }

        // ---- BACK COVER ----
        const back = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNo++;
        back.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawFrame(back, pal);
        drawCrest(back, PAGE_W / 2, 430, pal);
        drawCentered(back, 'This book belongs to', 380, 16, serifI, rgb(0.99, 0.98, 0.94));
        drawCentered(back, `${childName}`, 330, 32, serifBI, pal.accent);
        drawCentered(back, `Crafted uniquely in ${new Date().getFullYear()} • A one-of-a-kind keepsake`, 140, 11, serif, pal.accent);

        // 3. SAVE & SERVE
        console.log("Step 3: Saving PDF...");
        const pdfBytes = await pdfDoc.save();
        const safeName = String(childName).replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `book_${safeName}_${Date.now()}.pdf`;
        fs.writeFileSync(path.join(booksFolder, fileName), pdfBytes);
        console.log(`✅ Done in ${((Date.now() - t0) / 1000).toFixed(0)}s | ${pageNo} pages`);

        const publicUrl = `${req.protocol}://${req.get('host')}/books/${fileName}`;
        res.json({ success: true, pdfUrl: publicUrl });
    } catch (error) {
        console.error("❌ ERROR:", error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use('/books', express.static(path.join(__dirname, 'books')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));