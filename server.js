require('dotenv').config();
global.regeneratorRuntime = require('regenerator-runtime');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Replicate = require('replicate');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const Razorpay = require('razorpay');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '15mb' }));
app.use(cors());

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Razorpay initialization (degrades gracefully to simulation if keys are not set)
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && !process.env.RAZORPAY_KEY_ID.includes('YOUR_')) {
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    console.log('💳 Razorpay Gateway: ON (Live/Test keys active)');
} else {
    console.log('⚠️ Razorpay keys not configured — running in simulated checkout mode for testing');
}

// OPTIONAL permanent storage (degrades gracefully if not configured)
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('☁️ Supabase permanent storage: ON');
} else {
    console.log('⚠️ Supabase not configured — using local storage fallback');
}

// OPTIONAL email delivery (degrades gracefully if not configured)
let mailer = null;
if (process.env.BREVO_API_KEY && process.env.SENDER_EMAIL) {
    mailer = {
        sendMail: async ({ to, subject, html, text }) => {
            await axios.post('https://api.brevo.com/v3/smtp/email', {
                sender: { name: 'TwinkleTale', email: process.env.SENDER_EMAIL },
                to: [{ email: to }],
                subject: subject,
                htmlContent: html || `<p>${text}</p>`
            }, { headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' } });
        }
    };
    console.log('📧 Email delivery: ON (Brevo HTTPS)');
} else {
    console.log('⚠️ Brevo not configured — link-only delivery');
}

const booksFolder = path.join(__dirname, 'books');
if (!fs.existsSync(booksFolder)) fs.mkdirSync(booksFolder);

const fontsFolder = path.join(__dirname, 'fonts');
if (!fs.existsSync(fontsFolder)) fs.mkdirSync(fontsFolder);

const PAGE_W = 600, PAGE_H = 800;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STYLE = 'Award-winning children\'s picture book illustration, hand-painted gouache and soft watercolor texture, warm pastel palette, gentle storybook lighting, dreamy whimsical atmosphere, high detail, cohesive series style, no text, no words, no letters, no watermark: ';
const PACING = 10000;

// Preview session cache and Job status tracking
const previewSessions = new Map(); // previewId -> cached story + images
const activeJobs = new Map();       // jobId -> progress & status

// Clear old sessions after 2 hours
setInterval(() => {
    const now = Date.now();
    for (const [id, item] of previewSessions.entries()) {
        if (now - item.timestamp > 2 * 3600 * 1000) previewSessions.delete(id);
    }
    for (const [id, item] of activeJobs.entries()) {
        if (now - item.timestamp > 2 * 3600 * 1000) activeJobs.delete(id);
    }
}, 30 * 60 * 1000);

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

const hits = new Map();
function rateLimiter(req, res, next) {
    const ip = req.ip; const now = Date.now();
    const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
    if (arr.length >= 10) return res.status(429).json({ success: false, error: 'Too many requests. Please wait a minute and try again.' });
    arr.push(now); hits.set(ip, arr);
    next();
}

// 12 DIVERSE THEMES
function themeKit(base) {
    const b = String(base || '').toLowerCase();
    if (b.includes('space')) return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.20, 0.30), flatWord: 'solid flat deep indigo navy', motifs: 'tiny stars, crescent moons, little silver rockets and planets' };
    if (b.includes('animal') || b.includes('forest')) return { cover: rgb(0.10, 0.30, 0.24), accent: rgb(0.95, 0.80, 0.45), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.24, 0.20), flatWord: 'solid flat deep forest green', motifs: 'friendly forest animals, oak leaves, acorns and wildflowers' };
    if (b.includes('princess') || b.includes('castle') || b.includes('kingdom')) return { cover: rgb(0.55, 0.16, 0.35), accent: rgb(0.99, 0.85, 0.60), textBg: rgb(0.99, 0.96, 0.94), ink: rgb(0.32, 0.17, 0.24), flatWord: 'solid flat deep rose plum', motifs: 'roses, tiny golden crowns, castle spires and silk ribbons' };
    if (b.includes('super')) return { cover: rgb(0.45, 0.08, 0.12), accent: rgb(0.98, 0.75, 0.20), textBg: rgb(0.985, 0.96, 0.92), ink: rgb(0.30, 0.16, 0.14), flatWord: 'solid flat deep crimson', motifs: 'bright stars, hero shields and lightning bolts' };
    if (b.includes('dinosaur')) return { cover: rgb(0.18, 0.28, 0.15), accent: rgb(0.94, 0.76, 0.30), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.22, 0.24, 0.18), flatWord: 'solid flat deep moss green', motifs: 'prehistoric ferns, gentle friendly baby dinosaurs and amber leaves' };
    if (b.includes('ocean') || b.includes('dolphin') || b.includes('mermaid')) return { cover: rgb(0.06, 0.22, 0.38), accent: rgb(0.60, 0.88, 0.95), textBg: rgb(0.96, 0.98, 0.99), ink: rgb(0.12, 0.24, 0.34), flatWord: 'solid flat deep sapphire ocean blue', motifs: 'playful dolphins, seashells, starfish and coral reef bubbles' };
    if (b.includes('fairy') || b.includes('magic')) return { cover: rgb(0.38, 0.15, 0.42), accent: rgb(0.95, 0.82, 0.55), textBg: rgb(0.99, 0.96, 0.98), ink: rgb(0.28, 0.16, 0.30), flatWord: 'solid flat deep enchanted violet', motifs: 'glowing fireflies, tiny pixie wings, blossom lanterns and sparkles' };
    if (b.includes('train') || b.includes('vehicle')) return { cover: rgb(0.15, 0.24, 0.35), accent: rgb(0.96, 0.72, 0.22), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.22, 0.28), flatWord: 'solid flat deep slate navy', motifs: 'steam engines, little train tracks, station bells and signals' };
    if (b.includes('lullaby') || b.includes('bedtime') || b.includes('cloud')) return { cover: rgb(0.10, 0.14, 0.32), accent: rgb(0.98, 0.85, 0.48), textBg: rgb(0.985, 0.97, 0.94), ink: rgb(0.20, 0.22, 0.32), flatWord: 'solid flat midnight twilight blue', motifs: 'sleeping moons, soft woolly lambs, fluffy pillows and night stars' };
    if (b.includes('circus') || b.includes('carnival')) return { cover: rgb(0.42, 0.12, 0.18), accent: rgb(0.98, 0.82, 0.32), textBg: rgb(0.99, 0.97, 0.92), ink: rgb(0.30, 0.16, 0.18), flatWord: 'solid flat festive berry crimson', motifs: 'carousel horses, colorful balloons, circus tents and ribbons' };
    if (b.includes('unicorn') || b.includes('rainbow')) return { cover: rgb(0.48, 0.18, 0.38), accent: rgb(0.99, 0.85, 0.65), textBg: rgb(0.99, 0.96, 0.98), ink: rgb(0.32, 0.18, 0.26), flatWord: 'solid flat magical plum berry', motifs: 'golden unicorn horns, pastel rainbows, starry clouds and magic gems' };
    if (b.includes('safari') || b.includes('jungle')) return { cover: rgb(0.22, 0.28, 0.14), accent: rgb(0.95, 0.78, 0.30), textBg: rgb(0.98, 0.97, 0.93), ink: rgb(0.22, 0.24, 0.16), flatWord: 'solid flat deep safari khaki green', motifs: 'baby elephants, jungle palms, golden sunbeams and tropical birds' };
    return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.20, 0.30), flatWord: 'solid flat deep indigo navy', motifs: 'flowers, leaves, ribbons and golden bells' };
}

function themeTitle(base) {
    const b = String(base || '').toLowerCase();
    if (b.includes('space')) return 'Treasury of Space & Stars';
    if (b.includes('animal') || b.includes('forest')) return 'Treasury of Forest & Animals';
    if (b.includes('princess') || b.includes('castle') || b.includes('kingdom')) return 'Treasury of Kingdom & Castles';
    if (b.includes('super')) return 'Treasury of Superhero Stories';
    if (b.includes('dinosaur')) return 'Treasury of Dinosaur Wonders';
    if (b.includes('ocean') || b.includes('dolphin') || b.includes('mermaid')) return 'Treasury of Ocean & Dolphins';
    if (b.includes('fairy') || b.includes('magic')) return 'Treasury of Fairies & Magic Garden';
    if (b.includes('train') || b.includes('vehicle')) return 'Treasury of Trains & Tracks';
    if (b.includes('lullaby') || b.includes('bedtime') || b.includes('cloud')) return 'Treasury of Bedtime Lullabies';
    if (b.includes('circus') || b.includes('carnival')) return 'Treasury of Circus & Carnivals';
    if (b.includes('unicorn') || b.includes('rainbow')) return 'Treasury of Unicorns & Rainbows';
    if (b.includes('safari') || b.includes('jungle')) return 'Treasury of Jungle Safari';
    return 'Treasury of Wonderful Stories';
}

function getSceneCount(bookLength) {
    const s = String(bookLength || '').toLowerCase();
    if (s.includes('24') || s.includes('long')) return 12; // 12 scenes = 24 interior pages (12 left images + 12 right texts)
    if (s.includes('16')) return 8;                       // 8 scenes = 16 interior pages
    return 6;                                             // 6 scenes = 12 interior pages (Short Book standard)
}

function getCharacterDetails(childName, gender, age) {
    const g = String(gender || '').toLowerCase().trim();
    let genderClean = 'boy';
    let pronoun = 'his';
    let subjectPronoun = 'he';
    let childType = 'boy';

    if (g === 'girl') {
        genderClean = 'girl';
        pronoun = 'her';
        subjectPronoun = 'she';
        childType = 'girl';
    } else if (g === 'neutral' || g === 'star' || g === 'star child' || g === 'little star') {
        genderClean = 'little star';
        pronoun = 'their';
        subjectPronoun = 'they';
        childType = 'little star';
    }

    const childAge = parseInt(age, 10) || 5;
    const charAnchor = (genderClean === 'little star')
        ? `a cute and cheerful ${childAge}-year-old child named ${childName}`
        : `a cute ${childAge}-year-old ${genderClean} named ${childName}`;

    return { genderClean, childAge, pronoun, subjectPronoun, charAnchor };
}

// MULTILINGUAL FONT EMBEDDING
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
        console.log(`⚠️ Font embed fallback for ${lang}:`, e.message);
    }

    // Default Latin serif font
    return await pdfDoc.embedFont('Times-Roman');
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
        try {
            if (font.widthOfTextAtSize(test, size) <= maxWidth) cur = test;
            else { if (cur) lines.push(cur); cur = w; }
        } catch (e) {
            // In case of any glyph measurement edge case
            if (cur) lines.push(cur); cur = w;
        }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [String(text)];
}

function drawCentered(page, text, y, size, font, color, opacity) {
    try {
        const w = font.widthOfTextAtSize(text, size);
        page.drawText(text, { x: (PAGE_W - w) / 2, y, size, font, color, opacity: opacity === undefined ? 1 : opacity });
    } catch (e) {
        page.drawText(text, { x: 50, y, size, font, color, opacity: opacity === undefined ? 1 : opacity });
    }
}

function drawFlowLine(page, text, y, size, font, color, wave) {
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

function drawFrameVectors(page, pal) {
    page.drawRectangle({ x: 12, y: 12, width: PAGE_W - 24, height: PAGE_H - 24, borderColor: pal.accent, borderWidth: 2, borderOpacity: 0.9 });
    page.drawRectangle({ x: 20, y: 20, width: PAGE_W - 40, height: PAGE_H - 40, borderColor: pal.accent, borderWidth: 1, borderOpacity: 0.6 });
    const corners = [[20, 20], [PAGE_W - 20, 20], [20, PAGE_H - 20], [PAGE_W - 20, PAGE_H - 20]];
    for (const [cx, cy] of corners) {
        page.drawRectangle({ x: cx - 5, y: cy - 5, width: 10, height: 10, color: pal.accent, rotate: degrees(45) });
    }
}

async function generateImage(prompt, photoData) {
    if (photoData) {
        try {
            const out = await replicate.run("black-forest-labs/flux-kontext-pro", {
                input: { input_image: photoData, prompt: prompt, output_format: "png" }
            });
            return Array.isArray(out) ? out[0] : out;
        } catch (e) { console.log("    (face model failed, falling back to flux-1.1-pro)"); }
    }
    const out = await replicate.run("black-forest-labs/flux-1.1-pro", {
        input: { prompt: prompt, aspect_ratio: "3:4", output_format: "png" }
    });
    return Array.isArray(out) ? out[0] : out;
}

async function fetchImageBuffer(url) {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(res.data);
}

async function embedImageBuffer(pdfDoc, buf) {
    try { return await pdfDoc.embedPng(buf); }
    catch (e) { return await pdfDoc.embedJpg(buf); }
}

// ====================================================================
// FLOW B: STEP 1 - CREATE FREE TEASER PREVIEW (WITH LANGUAGE & GENDER)
// ====================================================================
app.post('/api/create-preview', rateLimiter, async (req, res) => {
    const t0 = Date.now();
    try {
        const { childName, gender, age, theme, language, photoData, dedication, email } = req.body;
        if (!childName) return res.status(400).json({ success: false, error: 'Child name is required' });

        const lang = String(language || 'English').trim();
        const { genderClean, childAge, pronoun, subjectPronoun, charAnchor } = getCharacterDetails(childName, gender, age);

        const base = String(theme || 'Story').split(' (')[0];
        const pal = themeKit(base);
        const title = themeTitle(base);
        assertZones();

        console.log(`✨ Preview | ${childName} (${genderClean}, ${childAge}) | ${base} | Lang=${lang}`);

        // Step 1: DeepSeek story outline & opening teaser rhyme in selected language
        const genderGuidance = (genderClean === 'little star')
            ? `The child is non-binary / gender-neutral (Little Star). Use gender-inclusive wording, using they/them pronouns or referring warmly to ${childName}.`
            : `The child protagonist is ${childName}, a ${childAge}-year-old ${genderClean} (${pronoun}/${subjectPronoun}).`;

        const storyResponse = await withRetry('preview story outline', () => axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: `You are an award-winning children's storybook author for TwinkleTale. Output ONLY a valid JSON object with keys:
"opening_rhyme": (4 lines of lyrical, warm read-aloud rhyme welcoming ${childName} into their bedtime adventure in ${lang}),
"story_scenes": (an array of 12 objects, each with "scene_title" [2-4 words in ${lang}], "page_text" [35-50 words in ${lang}], and "image_prompt" [one detailed sentence in English describing ${charAnchor} in this scene]).
${genderGuidance}
LANGUAGE REQUIREMENT: All child-facing text ("opening_rhyme", "scene_title", "page_text") MUST be written beautifully in ${lang} using its authentic script. No markdown, no commentary.`
                },
                {
                    role: 'user',
                    content: `Create an enchanting ${theme} bedtime storybook for ${childName} in ${lang}.`
                }
            ]
        }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` } }), 2, 3000);

        let storyText = storyResponse.data.choices[0].message.content;
        storyText = storyText.replace(/```json/g, '').replace(/```/g, '').trim();
        const storyJson = JSON.parse(storyText);
        const openingRhyme = storyJson.opening_rhyme || `Underneath the twinkling stars, where dreams begin to play,\nA special tale unfolds tonight, to softly guide your way.\nFor ${childName}, our little dreamer, so brave and kind and bright,\nA magical bedtime story starts before you sleep tonight.`;
        const scenesData = Array.isArray(storyJson.story_scenes) ? storyJson.story_scenes : [];

        // Step 2: Generate Cover Background + Child Vignette
        console.log("  → Painting preview cover background...");
        const bgPrompt = STYLE + `ornate storybook cover BACKGROUND only: elaborate golden-cream vine and leaf border with small vignettes of ${pal.motifs} confined strictly to the outer fifteen percent edges; two gentle painted flourish arches of tiny leaves and stars, one arching across the top center framing an empty name plaque area, and one arching across the lower middle framing an empty title plaque area; the rest of the inner field is ${pal.flatWord}, flat and empty except a few sparse tiny stars; absolutely no character, no person, no moon, no text, no letters anywhere; rich painterly detail`;
        const bgUrl = await withRetry('cover background', async () => generateImage(bgPrompt, null));
        const bgBuffer = await fetchImageBuffer(bgUrl);

        console.log("  → Painting preview child medallion vignette...");
        const vigPrompt = STYLE + `circular painted vignette portrait of ${photoData ? 'the exact same child from the reference photo' : charAnchor} as the storybook hero, head and shoulders, joyful expression, soft golden rim light, a few tiny ${pal.motifs} sparkles around the head, surrounded by ${pal.flatWord} background filling all four corners, vignette edges softly fading into that flat background`;
        const vigUrl = await withRetry('child vignette', async () => generateImage(vigPrompt, photoData));
        const vigBuffer = await fetchImageBuffer(vigUrl);

        const previewId = `prev_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        previewSessions.set(previewId, {
            timestamp: Date.now(),
            childName, gender: genderClean, age: childAge, theme, language: lang,
            photoData, dedication, email,
            charAnchor, pronoun, subjectPronoun, pal, title,
            bgBuffer, vigBuffer, bgUrl, vigUrl,
            scenesData, openingRhyme
        });

        console.log(`✅ Preview created in ${((Date.now() - t0) / 1000).toFixed(1)}s (id: ${previewId})`);

        res.json({
            success: true,
            previewId,
            childName,
            gender: genderClean,
            age: childAge,
            language: lang,
            bookTitle: title,
            openingRhyme,
            vignetteUrl: vigUrl,
            coverBgUrl: bgUrl
        });
    } catch (err) {
        console.error("❌ Preview error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ====================================================================
// FLOW B: STEP 2 - CREATE RAZORPAY ORDER
// ====================================================================
app.post('/api/create-order', rateLimiter, async (req, res) => {
    try {
        const { previewId, bookLength, email } = req.body;
        const session = previewSessions.get(previewId);
        if (!session && !previewId.startsWith('test_')) {
            return res.status(404).json({ success: false, error: 'Preview session expired. Please preview your book again.' });
        }

        const isLong = String(bookLength || '').toLowerCase().includes('long') || String(bookLength || '').includes('24');
        const amountPaise = isLong ? 29900 : 19900; // ₹299 for Long (24 pages), ₹199 for Short (12 pages)

        if (razorpay) {
            const order = await razorpay.orders.create({
                amount: amountPaise,
                currency: 'INR',
                receipt: (previewId || `rcpt_${Date.now()}`).slice(0, 30),
                notes: {
                    previewId: previewId || '',
                    bookLength: isLong ? '24 pages' : '12 pages',
                    childName: session ? session.childName : 'Child',
                    email: email || (session ? session.email : '')
                }
            });
            return res.json({
                success: true,
                orderId: order.id,
                amount: amountPaise,
                currency: 'INR',
                keyId: process.env.RAZORPAY_KEY_ID
            });
        } else {
            // Simulated Test Order for zero-friction local and staging development
            const simOrderId = `order_sim_${Date.now()}`;
            return res.json({
                success: true,
                orderId: simOrderId,
                amount: amountPaise,
                currency: 'INR',
                keyId: 'rzp_test_simulated_key',
                isTestMode: true
            });
        }
    } catch (err) {
        console.error("❌ Order creation error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ====================================================================
// FLOW B: STEP 3 - VERIFY PAYMENT & DISPATCH GENERATION JOB
// ====================================================================
app.post('/api/verify-and-complete-book', rateLimiter, async (req, res) => {
    try {
        const {
            previewId,
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            bookLength,
            email
        } = req.body;

        const session = previewSessions.get(previewId);
        if (!session) {
            return res.status(404).json({ success: false, error: 'Preview session expired or not found' });
        }

        if (razorpay && process.env.RAZORPAY_KEY_SECRET) {
            const expectedSig = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex');

            if (expectedSig !== razorpay_signature) {
                return res.status(400).json({ success: false, error: 'Payment signature verification failed' });
            }
            console.log(`💳 Payment Verified: ${razorpay_payment_id} for order ${razorpay_order_id}`);
        } else {
            console.log(`💳 Test Payment processed: ${razorpay_payment_id || 'test_payment'} for order ${razorpay_order_id}`);
        }

        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        activeJobs.set(jobId, {
            id: jobId,
            timestamp: Date.now(),
            status: 'generating',
            progress: 15,
            step: 'Painting decorative story borders...',
            pdfUrl: null,
            emailed: false,
            error: null
        });

        // Run full assembly in background
        assembleFullBookAsync(jobId, session, bookLength, email || session.email, req.protocol, req.get('host'));

        res.json({ success: true, jobId });
    } catch (err) {
        console.error("❌ Verify error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ====================================================================
// JOB STATUS POLLING
// ====================================================================
app.get('/api/job-status/:jobId', (req, res) => {
    const job = activeJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({
        success: true,
        status: job.status,
        progress: job.progress,
        step: job.step,
        pdfUrl: job.pdfUrl,
        emailed: job.emailed,
        error: job.error
    });
});

// ====================================================================
// ASYNC BACKGROUND FULFILLMENT WORKER (MULTILINGUAL + SPREAD LAYOUT)
// ====================================================================
async function assembleFullBookAsync(jobId, session, bookLength, parentEmail, protocol, host) {
    const update = (progress, step) => {
        const j = activeJobs.get(jobId);
        if (j) { j.progress = progress; j.step = step; }
    };

    try {
        const {
            childName, gender, age, theme, language, photoData, dedication,
            charAnchor, pronoun, pal, title,
            bgBuffer, vigBuffer, scenesData
        } = session;

        const scenes = getSceneCount(bookLength);
        console.log(`📖 Async Assembly Job ${jobId} | ${childName} | scenes=${scenes} | Lang=${language}`);

        const pdfDoc = await PDFDocument.create();
        pdfDoc.setTitle(`${childName}'s ${title}`);
        pdfDoc.setAuthor('TwinkleTale');
        pdfDoc.setSubject(`A personalized keepsake bedtime storybook for ${childName}`);
        pdfDoc.setCreator('TwinkleTale Studios AI');

        // Embed language-aware typography
        const bookFont = await getFontForLanguage(pdfDoc, language);
        const serifBI = await pdfDoc.embedFont('Times-BoldItalic');
        const serifB = await pdfDoc.embedFont('Times-Bold');
        const serifI = await pdfDoc.embedFont('Times-Italic');

        update(20, 'Painting decorative chapter borders...');
        const framePrompt = STYLE + `decorative rectangular border frame for a children's book page, repeating hand-painted motifs of ${pal.motifs} woven with ribbons and leaves around all four edges, wide plain warm cream empty center occupying seventy percent of the page, soft pastel palette, gentle textures`;
        const frameImgBuffer = await withRetry('frame image', async () => fetchImageBuffer(await generateImage(framePrompt, null)));
        const frameImg = await embedImageBuffer(pdfDoc, frameImgBuffer);
        await sleep(PACING);

        // ================= PAGE 1: FRONT COVER =================
        update(30, 'Binding front cover...');
        const bgImg = await embedImageBuffer(pdfDoc, bgBuffer);
        const vigImg = await embedImageBuffer(pdfDoc, vigBuffer);

        const cover = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        cover.drawImage(bgImg, coverFit(bgImg, PAGE_W, PAGE_H));

        const d = Z.medal.r * 2;
        const fit = coverFit(vigImg, d, d);
        const dx = (Z.medal.cx - Z.medal.r) + fit.x;
        const dy2 = (Z.medal.cy - Z.medal.r) + fit.y;
        cover.drawImage(vigImg, { x: dx, y: dy2, width: fit.width, height: fit.height });
        cover.drawEllipse({ x: Z.medal.cx, y: Z.medal.cy, xScale: Z.medal.r + 5, yScale: Z.medal.r + 5, borderColor: pal.accent, borderWidth: 3.5 });
        cover.drawEllipse({ x: Z.medal.cx, y: Z.medal.cy, xScale: Z.medal.r + 11, yScale: Z.medal.r + 11, borderColor: pal.accent, borderWidth: 1.5, borderOpacity: 0.7 });

        drawFlowLine(cover, `${childName}'s`, 700, 44, serifBI, pal.accent, 2);
        let tSize = 40;
        let tLines = wrapText(title, bookFont || serifB, tSize, 470);
        if (tLines.length > 3) { tSize = 34; tLines = wrapText(title, bookFont || serifB, tSize, 470); }
        let ty = 292;
        for (const line of tLines) {
            drawFlowLine(cover, line, ty, tSize, bookFont || serifB, rgb(0.99, 0.98, 0.94), 3);
            ty -= 46;
        }

        // ================= PAGE 2 (LEFT): FRONTISPIECE / WELCOME =================
        const frontis = pdfDoc.addPage([PAGE_W, PAGE_H]);
        frontis.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawFrameVectors(frontis, pal);
        drawCentered(frontis, 'TwinkleTale', 480, 22, serifBI, pal.accent);
        drawCentered(frontis, 'Personalized Keepsake Storybooks', 450, 13, serifI, rgb(0.95, 0.95, 0.95), 0.9);
        drawCentered(frontis, '✨', 410, 20, bookFont, pal.accent);
        drawCentered(frontis, `A Special Bedtime Treasury for ${childName}`, 370, 16, bookFont || serifB, rgb(0.99, 0.98, 0.94));
        drawCentered(frontis, `Language: ${language || 'English'} • Year ${new Date().getFullYear()}`, 200, 11, bookFont, pal.accent, 0.8);

        // ================= PAGE 3 (RIGHT): DEDICATION PAGE =================
        const ded = pdfDoc.addPage([PAGE_W, PAGE_H]);
        ded.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
        ded.drawImage(frameImg, coverFit(frameImg, PAGE_W, PAGE_H));
        ded.drawRectangle({ x: PAGE_W / 2 - 5, y: 596, width: 10, height: 10, color: pal.cover, rotate: degrees(45) });
        drawCentered(ded, `For ${childName},`, 520, 32, serifBI, pal.cover);
        const dedText = (dedication && dedication.trim()) ? dedication.trim() : `May this little story remind you, every single night, just how hugely loved and cherished you are. Dream big little star!`;
        const dedLines = wrapText(dedText, bookFont || serifI, 18, 380);
        let dy = 450 - ((450 - 210) - dedLines.length * 32) / 2;
        for (const line of dedLines) {
            drawCentered(ded, line, dy, 18, bookFont || serifI, pal.ink);
            dy -= 32;
        }
        drawCentered(ded, `Printed just for you • ${new Date().getFullYear()}`, 130, 11, bookFont, pal.ink, 0.85);

        // Validate or fallback scenes
        const effectiveScenes = (scenesData || []).slice(0, scenes);
        while (effectiveScenes.length < scenes) {
            const idx = effectiveScenes.length + 1;
            effectiveScenes.push({
                scene_title: `Magical Wonder ${idx}`,
                page_text: `Under the soft glow of twilight, ${childName} discovered a world full of kindness and starlight, smiling as their adventure continued with wonder and joy.`,
                image_prompt: `whimsical storybook scene of ${charAnchor} exploring magical glowing landscapes full of wonder`
            });
        }

        // ================= INTERIOR SPREADS: LEFT IMAGE + RIGHT TEXT =================
        let spreadIndex = 1;
        for (let i = 0; i < scenes; i++) {
            const scene = effectiveScenes[i];
            const pct = Math.round(35 + (i / scenes) * 55);
            update(pct, `Illustrating Spread ${i + 1} of ${scenes}: "${scene.scene_title}"...`);
            console.log(`  → Scene ${i + 1}/${scenes}: ${scene.scene_title}`);

            const scenePrompt = STYLE + `${charAnchor} with a joyful smile in the scene: ${scene.image_prompt}`;
            const sceneImgBuf = await withRetry(`scene ${i + 1} image`, async () => fetchImageBuffer(await generateImage(scenePrompt, photoData)));
            const sceneImg = await embedImageBuffer(pdfDoc, sceneImgBuf);

            // LEFT PAGE: Full-bleed Scene Illustration
            const imgPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            imgPage.drawImage(sceneImg, coverFit(sceneImg, PAGE_W, PAGE_H));

            // RIGHT PAGE: Framed Verse Page
            const textPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            textPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
            textPage.drawImage(frameImg, coverFit(frameImg, PAGE_W, PAGE_H));

            drawCentered(textPage, scene.scene_title, 600, 26, bookFont || serifB, pal.cover);
            textPage.drawRectangle({ x: PAGE_W / 2 - 4, y: 566, width: 8, height: 8, color: pal.cover, rotate: degrees(45) });

            const verseLines = wrapText(scene.page_text, bookFont || serifB, 18, 400);
            let by = 520 - ((520 - 160) - verseLines.length * 32) / 2;
            for (const line of verseLines) {
                drawCentered(textPage, line, by, 18, bookFont, pal.ink);
                by -= 32;
            }
            drawCentered(textPage, `Spread ${spreadIndex}`, 112, 11, bookFont, pal.ink, 0.75);
            spreadIndex++;

            if (i < scenes - 1) {
                console.log("  ⏳ Pacing 10s...");
                await sleep(PACING);
            }
        }

        // ================= KEEPSAKE CERTIFICATE PAGE =================
        update(92, 'Generating keepsake certificate...');
        const cert = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cert.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
        cert.drawImage(frameImg, coverFit(frameImg, PAGE_W, PAGE_H));
        drawCentered(cert, 'Official Keepsake Certificate', 580, 24, serifBI, pal.cover);
        cert.drawRectangle({ x: PAGE_W / 2 - 4, y: 546, width: 8, height: 8, color: pal.cover, rotate: degrees(45) });
        drawCentered(cert, 'This bedtime treasury belongs to', 460, 18, bookFont || serifI, pal.ink);
        drawCentered(cert, childName, 390, 36, bookFont || serifB, pal.cover);
        drawCentered(cert, '⭐ ⭐ ⭐', 330, 16, bookFont, pal.accent);
        drawCentered(cert, `Crafted uniquely in ${new Date().getFullYear()} • Handcrafted with love`, 260, 14, bookFont || serifI, pal.ink);
        drawCentered(cert, 'TwinkleTale Personalized Books', 140, 11, bookFont, pal.ink, 0.8);

        // ================= BACK COVER =================
        update(95, 'Sealing book back cover...');
        const back = pdfDoc.addPage([PAGE_W, PAGE_H]);
        back.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawFrameVectors(back, pal);
        drawCentered(back, 'TwinkleTale', 450, 32, serifBI, pal.accent);
        drawCentered(back, 'Every child is the hero of their own bedtime story.', 405, 14, serifI, rgb(0.98, 0.98, 0.98));
        drawCentered(back, `Created especially for ${childName}`, 340, 22, serifB, pal.accent);
        drawCentered(back, `A one-of-a-kind keepsake • ${new Date().getFullYear()}`, 140, 11, serif, pal.accent);

        // ================= SAVE & UPLOAD =================
        update(97, 'Saving print-ready PDF...');
        const pdfBytes = await pdfDoc.save();
        const safeName = String(childName).replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `twinkletale_${safeName}_${Date.now()}.pdf`;
        let pdfUrl = null;

        if (supabase) {
            try {
                const up = await supabase.storage.from('storybooks').upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: false });
                if (!up.error) pdfUrl = supabase.storage.from('storybooks').getPublicUrl(fileName).data.publicUrl;
                console.log("☁️ Saved permanently to Supabase:", pdfUrl);
            } catch (e) {
                console.log("⚠️ Supabase upload failed, falling back to local:", e.message);
                pdfUrl = null;
            }
        }
        if (!pdfUrl) {
            fs.writeFileSync(path.join(booksFolder, fileName), pdfBytes);
            pdfUrl = `${protocol}://${host}/books/${fileName}`;
            console.log("💾 Saved locally (fallback):", pdfUrl);
        }

        // ================= EMAIL DELIVERY =================
        let emailed = false;
        if (mailer && parentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
            update(99, 'Dispatching personalized delivery email...');
            try {
                await mailer.sendMail({
                    to: parentEmail,
                    subject: `✨ ${childName}'s Personalized Storybook is Ready! (TwinkleTale)`,
                    html: `<div style="font-family:Georgia,serif;padding:32px;background:#FAF7F2;border-radius:12px;max-width:600px;margin:0 auto;border:1px solid #EAE4D9">
                        <h2 style="color:#161B33;margin-top:0">✨ ${childName}'s ${title} is ready!</h2>
                        <p style="font-size:16px;color:#333;line-height:1.6">Hello! We have finished crafting your personalized keepsake bedtime storybook for <strong>${childName}</strong> in <strong>${language || 'English'}</strong>.</p>
                        <p style="text-align:center;margin:30px 0">
                            <a href="${pdfUrl}" target="_blank" style="background:#1B4938;color:#FAF7F2;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;display:inline-block">📥 Download Print-Ready Storybook (PDF)</a>
                        </p>
                        <p style="font-size:13px;color:#777;line-height:1.5">You can read this on any phone, iPad, tablet, or print it out on A4/Letter paper to make a physical bedside book.</p>
                        <hr style="border:none;border-top:1px solid #DDD;margin:24px 0">
                        <p style="font-size:12px;color:#999;text-align:center">This link is permanent and never expires.<br>Crafted with love by TwinkleTale Studios.</p>
                    </div>`
                });
                emailed = true;
                console.log("📧 Delivery email sent to:", parentEmail);
            } catch (e) {
                console.log("⚠️ Email delivery notice:", e.message);
            }
        }

        const job = activeJobs.get(jobId);
        if (job) {
            job.status = 'completed';
            job.progress = 100;
            job.step = 'Your storybook is ready!';
            job.pdfUrl = pdfUrl;
            job.emailed = emailed;
        }
        console.log(`🎉 Job ${jobId} Completed! Pages=${pdfDoc.getPageCount()} | PDF: ${pdfUrl}`);
    } catch (err) {
        console.error(`❌ Job ${jobId} Failed:`, err.message);
        const job = activeJobs.get(jobId);
        if (job) {
            job.status = 'failed';
            job.error = err.message;
            job.step = 'Generation encountered an error';
        }
    }
}

// ====================================================================
// DIRECT BOOK GENERATION (SMOKE TEST ENDPOINT)
// ====================================================================
app.post('/api/create-book', rateLimiter, async (req, res) => {
    const t0 = Date.now();
    try {
        const { childName, gender, age, theme, language, photoData, bookLength, dedication, email } = req.body;
        if (!childName) return res.status(400).json({ success: false, error: 'Child name is required' });

        const lang = String(language || 'English').trim();
        const { genderClean, childAge, pronoun, subjectPronoun, charAnchor } = getCharacterDetails(childName, gender, age);

        const base = String(theme || 'Story').split(' (')[0];
        const scenes = getSceneCount(bookLength);
        const pal = themeKit(base);
        const title = themeTitle(base);
        assertZones();

        console.log(`📘 Direct Book v8 | ${childName} (${genderClean}, ${childAge}) | ${base} | Lang=${lang} | scenes=${scenes}`);

        const genderGuidance = (genderClean === 'little star')
            ? `The child is non-binary / gender-neutral (Little Star). Use gender-inclusive wording with they/them or ${childName}.`
            : `The child protagonist is ${childName}, a ${childAge}-year-old ${genderClean} (${pronoun}/${subjectPronoun}).`;

        const storyResponse = await withRetry('story', () => axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: `You are an award-winning children's storybook author for TwinkleTale. Output ONLY a valid JSON array of ${scenes} objects. No markdown, no extra text.
${genderGuidance}
Each object must have "scene_title" (2-4 words in ${lang}), "page_text" (35-50 words in ${lang}), and "image_prompt" (one detailed sentence in English describing ${charAnchor}).
Write all scene text in ${lang} using its authentic script.`
                },
                {
                    role: 'user',
                    content: `Write a ${scenes}-scene bedtime story for ${childName} in ${lang} about ${theme}.`
                }
            ]
        }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` } }), 2, 3000);

        let storyText = storyResponse.data.choices[0].message.content;
        storyText = storyText.replace(/```json/g, '').replace(/```/g, '').trim();
        const rawPages = JSON.parse(storyText);
        const pages = (Array.isArray(rawPages) ? rawPages : []).slice(0, scenes);

        const session = {
            childName, gender: genderClean, age: childAge, theme, language: lang,
            photoData, dedication, email,
            charAnchor, pronoun, subjectPronoun, pal, title,
            bgBuffer: null, vigBuffer: null, scenesData: pages
        };

        const bgPrompt = STYLE + `ornate storybook cover BACKGROUND only: elaborate golden-cream vine and leaf border with small vignettes of ${pal.motifs} confined strictly to the outer fifteen percent edges; two gentle painted flourish arches of tiny leaves and stars, one arching across the top center framing an empty name plaque area, and one arching across the lower middle framing an empty title plaque area; the rest of the inner field is ${pal.flatWord}, flat and empty except a few sparse tiny stars; absolutely no character, no person, no moon, no text, no letters anywhere; rich painterly detail`;
        session.bgBuffer = await fetchImageBuffer(await generateImage(bgPrompt, null));
        await sleep(PACING);

        const vigPrompt = STYLE + `circular painted vignette portrait of ${photoData ? 'the exact same child from the reference photo' : charAnchor} as the storybook hero, head and shoulders, joyful expression, soft golden rim light, a few tiny ${pal.motifs} sparkles around the head, surrounded by ${pal.flatWord} background filling all four corners, vignette edges softly fading into that flat background`;
        session.vigBuffer = await fetchImageBuffer(await generateImage(vigPrompt, photoData));
        await sleep(PACING);

        const testJobId = `direct_${Date.now()}`;
        activeJobs.set(testJobId, { id: testJobId, status: 'generating', progress: 50, step: 'Generating', pdfUrl: null, emailed: false });
        await assembleFullBookAsync(testJobId, session, bookLength, email, req.protocol, req.get('host'));

        const finished = activeJobs.get(testJobId);
        res.json({ success: true, pdfUrl: finished.pdfUrl, emailed: finished.emailed, elapsedSeconds: ((Date.now() - t0) / 1000).toFixed(0) });
    } catch (err) {
        console.error("❌ Error in create-book:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/test-email', async (req, res) => {
    if (!process.env.EMAIL_TEST_TOKEN || req.query.token !== process.env.EMAIL_TEST_TOKEN) return res.status(403).json({ ok: false });
    if (!mailer) return res.json({ ok: false, error: 'mailer not configured' });
    try {
        await mailer.sendMail({ to: process.env.SENDER_EMAIL, subject: 'TwinkleTale email delivery test', html: '<p>TwinkleTale email delivery is active!</p>' });
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false, error: e.message, brevoSays: e.response ? e.response.data : null });
    }
});

app.use('/books', express.static(path.join(__dirname, 'books')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 TwinkleTale Server running on port ${PORT}`));