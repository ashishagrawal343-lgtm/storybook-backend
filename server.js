require('dotenv').config();
global.regeneratorRuntime = require('regenerator-runtime');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Replicate = require('replicate');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const Razorpay = require('razorpay');
const sharp = require('sharp');
// Strictly cap sharp/libvips cache so it never exceeds 16MB of RAM
sharp.cache({ memory: 16, files: 0, items: 5 });

// ====================================================================
// CRITICAL PATCH: fontkit GPOS null anchor bug fix for Indic/Arabic fonts
// ====================================================================
try {
    const fontkitDistPath = path.join(__dirname, 'node_modules/@pdf-lib/fontkit/dist/fontkit.umd.js');
    if (fs.existsSync(fontkitDistPath)) {
        let code = fs.readFileSync(fontkitDistPath, 'utf8');
        let patched = false;
        if (code.includes('var x = anchor.xCoordinate;')) {
            code = code.replace(
                '_proto.getAnchor = function getAnchor(anchor) {',
                '_proto.getAnchor = function getAnchor(anchor) {\n    if (!anchor) return { x: 0, y: 0 };'
            );
            patched = true;
        }
        if (code.includes('_proto.applyAnchor = function applyAnchor(markRecord, baseAnchor, baseGlyphIndex) {')) {
            code = code.replace(
                '_proto.applyAnchor = function applyAnchor(markRecord, baseAnchor, baseGlyphIndex) {',
                '_proto.applyAnchor = function applyAnchor(markRecord, baseAnchor, baseGlyphIndex) {\n    if (!baseAnchor || !markRecord || !markRecord.markAnchor) return;'
            );
            patched = true;
        }
        if (patched) {
            fs.writeFileSync(fontkitDistPath, code);
            console.log('✅ Fontkit GPOS anchor patch applied successfully');
        }
    }
} catch (patchErr) {
    console.warn('⚠️ Could not apply fontkit patch:', patchErr.message);
}

const fontkit = require('@pdf-lib/fontkit');

// ====================================================================
// CRITICAL PATCH: pdf-lib CustomFontEmbedder pre-base vowel advance & full glyph cache fix
// ====================================================================
try {
    const CustomFontEmbedder = require('pdf-lib/cjs/core/embedders/CustomFontEmbedder').default;
    if (CustomFontEmbedder && CustomFontEmbedder.prototype) {
        CustomFontEmbedder.prototype.computeWidths = function () {
            var glyphs = this.glyphCache.access();
            var widths = [];
            var currSection = [];
            for (var idx = 0, len = glyphs.length; idx < len; idx++) {
                var currGlyph = glyphs[idx];
                var prevGlyph = glyphs[idx - 1];
                var currGlyphId = this.glyphId(currGlyph);
                var prevGlyphId = this.glyphId(prevGlyph);
                if (idx === 0) {
                    widths.push(currGlyphId);
                }
                else if (currGlyphId - prevGlyphId !== 1) {
                    widths.push(currSection);
                    widths.push(currGlyphId);
                    currSection = [];
                }

                let adv = (currGlyph && currGlyph.advanceWidth) || 0;
                const name = (currGlyph && currGlyph.name) || '';
                // Pre-base vowel signs (Hindi choti-i, Bengali, Telugu, etc.) must not advance before consonant
                if (name.startsWith('ivowelsign') || name === 'dvmI' || name.startsWith('dvmI.')) {
                    adv = 0;
                }
                currSection.push(adv * this.scale);
            }
            widths.push(currSection);
            return widths;
        };
        console.log('✅ CustomFontEmbedder pre-base vowel advance patch applied successfully');
    }
} catch (embedErr) {
    console.warn('⚠️ Could not apply CustomFontEmbedder patch:', embedErr.message);
}

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Razorpay initialization
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

// Supabase permanent storage
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('☁️ Supabase permanent storage: ON');
} else {
    console.log('⚠️ Supabase not configured — using local storage fallback');
}

// Email delivery
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
const STYLE = 'Masterpiece children\'s storybook illustration, rich painterly storybook realism, soft digital gouache and fine oils texture, warm cinematic volumetric lighting, gentle golden hour rim light, adorable expressive child character with soulful sparkling dark eyes, natural soft dimensional skin tones with gentle peachy warmth, finely rendered silky hair catching the light, charming button nose and joyful smile, highly detailed enchanted surroundings with floating magical motes and glowing starlight, cinematic depth of field, art by Oliver Jeffers and Chris Van Allsburg, award-winning picture book, no text, no words, no letters, no watermark, not flat 2D cartoon, not 3D CGI plastic render: ';
const PACING = 10000;

// Preview session cache, Job status tracking, and Replay-Attack Prevention
const previewSessions = new Map();
const activeJobs = new Map();
const fulfilledPayments = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [id, item] of previewSessions.entries()) {
        if (now - item.timestamp > 30 * 60 * 1000) {
            try {
                const fPath = path.join(booksFolder, `preview_${id}_cover.png`);
                if (fs.existsSync(fPath)) fs.unlinkSync(fPath);
            } catch (_) {}
            previewSessions.delete(id);
        }
    }
    for (const [id, item] of activeJobs.entries()) {
        if (now - item.timestamp > 30 * 60 * 1000) activeJobs.delete(id);
    }
    for (const [id, timestamp] of fulfilledPayments.entries()) {
        if (now - timestamp > 48 * 3600 * 1000) fulfilledPayments.delete(id);
    }
}, 10 * 60 * 1000);

// COVER PRINT-SAFE ZONES (MATHEMATICALLY PREVENTS OVERLAP)
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
    if (arr.length >= 12) return res.status(429).json({ success: false, error: 'Too many requests. Please wait a minute and try again.' });
    arr.push(now); hits.set(ip, arr);
    next();
}

// 12 DIVERSE THEMES WITH THEME-SPECIFIC BORDER STYLES
function themeKit(base) {
    const b = String(base || '').toLowerCase();
    if (b.includes('space')) return {
        cover: rgb(0.05, 0.10, 0.32),
        accent: rgb(0.96, 0.78, 0.26),
        textBg: rgb(0.985, 0.965, 0.92),
        ink: rgb(0.20, 0.20, 0.30),
        flatWord: 'solid flat deep indigo navy',
        motifs: 'tiny stars, crescent moons, little silver rockets and planets',
        borderDesc: 'celestial starlight border with constellation lines, glowing cosmic dust, miniature crescent moons, tiny Saturn-like planets, and gleaming starbursts strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('animal') || b.includes('forest')) return {
        cover: rgb(0.10, 0.30, 0.24),
        accent: rgb(0.95, 0.80, 0.45),
        textBg: rgb(0.985, 0.965, 0.92),
        ink: rgb(0.20, 0.24, 0.20),
        flatWord: 'solid flat deep forest green',
        motifs: 'friendly forest animals, oak leaves, acorns and wildflowers',
        borderDesc: 'lush woodland botanical border of entwined oak and fern boughs, golden acorns, tiny forest berries, blooming woodland wildflowers, and gentle firefly motes strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('princess') || b.includes('castle') || b.includes('kingdom')) return {
        cover: rgb(0.55, 0.16, 0.35),
        accent: rgb(0.99, 0.85, 0.60),
        textBg: rgb(0.99, 0.96, 0.94),
        ink: rgb(0.32, 0.17, 0.24),
        flatWord: 'solid flat deep rose plum',
        motifs: 'roses, tiny golden crowns, castle spires and silk ribbons',
        borderDesc: 'regal fairytale baroque border of delicate royal rose garlands, ornate filigree scrollwork, tiny jeweled tiara motifs, and flowing silk ribbons strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('super')) return {
        cover: rgb(0.45, 0.08, 0.12),
        accent: rgb(0.98, 0.75, 0.20),
        textBg: rgb(0.985, 0.96, 0.92),
        ink: rgb(0.30, 0.16, 0.14),
        flatWord: 'solid flat deep heroic crimson-black',
        motifs: 'bright stars, hero shields and lightning bolts',
        borderDesc: 'dynamic art deco heroic emblem border with geometric lightning crests, bold starburst corner shields, soaring heroic velocity lines, and golden energy flares strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('dinosaur')) return {
        cover: rgb(0.18, 0.28, 0.15),
        accent: rgb(0.94, 0.76, 0.30),
        textBg: rgb(0.985, 0.965, 0.92),
        ink: rgb(0.22, 0.24, 0.18),
        flatWord: 'solid flat deep moss green',
        motifs: 'prehistoric ferns, gentle friendly baby dinosaurs and amber leaves',
        borderDesc: 'ancient prehistoric botanical border of lush prehistoric cycad and fern fronds, fossil stone carvings, polished amber gemstones, and tropical jungle leaves strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('ocean') || b.includes('dolphin') || b.includes('mermaid')) return {
        cover: rgb(0.06, 0.22, 0.38),
        accent: rgb(0.60, 0.88, 0.95),
        textBg: rgb(0.96, 0.98, 0.99),
        ink: rgb(0.12, 0.24, 0.34),
        flatWord: 'solid flat deep oceanic sapphire blue',
        motifs: 'playful dolphins, seashells, starfish and coral reef bubbles',
        borderDesc: 'enchanted aquatic ocean border of sculpted coral branches, sea kelp ribbons, luminous pearl strands, iridescent seashells, and shimmering sea glass bubbles strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('fairy') || b.includes('magic')) return {
        cover: rgb(0.38, 0.15, 0.42),
        accent: rgb(0.95, 0.82, 0.55),
        textBg: rgb(0.99, 0.96, 0.98),
        ink: rgb(0.28, 0.16, 0.30),
        flatWord: 'solid flat deep enchanted violet',
        motifs: 'glowing fireflies, tiny pixie wings, blossom lanterns and sparkles',
        borderDesc: 'enchanted fairy garden border of delicate morning-glory vines, glowing pixie dust trails, crystal lantern blooms, and gossamer butterfly wings strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('train') || b.includes('vehicle')) return {
        cover: rgb(0.15, 0.24, 0.35),
        accent: rgb(0.96, 0.72, 0.22),
        textBg: rgb(0.985, 0.965, 0.92),
        ink: rgb(0.20, 0.22, 0.28),
        flatWord: 'solid flat deep slate navy',
        motifs: 'steam engines, little train tracks, station bells and signals',
        borderDesc: 'vintage storybook locomotive border of polished brass steam train tracks, miniature telegraph gears, lantern lamps, and golden railway signals strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('lullaby') || b.includes('bedtime') || b.includes('cloud')) return {
        cover: rgb(0.10, 0.14, 0.32),
        accent: rgb(0.98, 0.85, 0.48),
        textBg: rgb(0.985, 0.97, 0.94),
        ink: rgb(0.20, 0.22, 0.32),
        flatWord: 'solid flat midnight twilight blue',
        motifs: 'sleeping moons, soft woolly lambs, fluffy pillows and night stars',
        borderDesc: 'dreamy bedtime lullaby border of soft billowing cloud ribbons, sleeping crescent moons, slumbering stardust trails, and gentle golden lullaby notes strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('circus') || b.includes('carnival')) return {
        cover: rgb(0.42, 0.12, 0.18),
        accent: rgb(0.98, 0.82, 0.32),
        textBg: rgb(0.99, 0.97, 0.92),
        ink: rgb(0.30, 0.16, 0.18),
        flatWord: 'solid flat festive berry crimson',
        motifs: 'carousel horses, colorful balloons, circus tents and ribbons',
        borderDesc: 'festive vintage carnival border of golden carousel filigree, carnival pennant bunting, festive star ribbons, and ornamental circus flourishes strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('unicorn') || b.includes('rainbow')) return {
        cover: rgb(0.48, 0.18, 0.38),
        accent: rgb(0.99, 0.85, 0.65),
        textBg: rgb(0.99, 0.96, 0.98),
        ink: rgb(0.32, 0.18, 0.26),
        flatWord: 'solid flat magical plum berry',
        motifs: 'golden unicorn horns, pastel rainbows, starry clouds and magic gems',
        borderDesc: 'magical celestial unicorn border of flowing pastel rainbow ribbons, starlit crystal gems, golden clover vines, and shimmering sparkle flourishes strictly along the outer perimeter edges and four corners only'
    };
    if (b.includes('safari') || b.includes('jungle')) return {
        cover: rgb(0.22, 0.28, 0.14),
        accent: rgb(0.95, 0.78, 0.30),
        textBg: rgb(0.98, 0.97, 0.93),
        ink: rgb(0.22, 0.24, 0.16),
        flatWord: 'solid flat deep safari khaki green',
        motifs: 'baby elephants, jungle palms, golden sunbeams and tropical birds',
        borderDesc: 'vibrant savannah safari border of exotic jungle palm fronds, golden acacia branches, sunbeam rays, and tribal storybook vine scrollwork strictly along the outer perimeter edges and four corners only'
    };
    return {
        cover: rgb(0.05, 0.10, 0.32),
        accent: rgb(0.96, 0.78, 0.26),
        textBg: rgb(0.985, 0.965, 0.92),
        ink: rgb(0.20, 0.20, 0.30),
        flatWord: 'solid flat deep indigo navy',
        motifs: 'flowers, leaves, ribbons and golden bells',
        borderDesc: 'ornate storybook border with elegant filigree vine scrollwork, ribbons, and delicate decorative corners strictly along the outer perimeter edges and four corners only'
    };
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
    if (s.includes('24') || s.includes('long')) return 12; // 12 scenes = 24 interior pages
    if (s.includes('16')) return 8;                       // 8 scenes = 16 interior pages
    return 6;                                             // 6 scenes = 12 interior pages (Treasury standard)
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

    // Theme-locked signature outfit to prevent wardrobe drift across pages
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

// Helper to safely extract string URL from Replicate output
function extractUrl(out) {
    if (!out) return '';
    const item = Array.isArray(out) ? out[0] : out;
    if (typeof item === 'string') return item;
    if (item && typeof item.url === 'function') {
        const u = item.url();
        if (typeof u === 'string') return u;
        if (u && u.href) return u.href;
        return String(u || '');
    }
    if (item && item.href) return item.href;
    if (item && item.url && typeof item.url === 'string') return item.url;
    return String(item || '');
}

// MULTILINGUAL SCRIPT DETECTION & FONT ROUTING (PREVENTS TOFU [][][][] GLYPHS)
function isNonLatin(text) {
    return /[\u0600-\u06FF\u0900-\u0DFF\u0E00-\u0E7F]/.test(String(text || ''));
}

function chooseFont(text, bookFont, latinFont) {
    if (isNonLatin(text) && bookFont) return bookFont;
    return latinFont;
}

// MULTILINGUAL SCRIPT TEXT SANITIZER (PREVENTS ACCIDENTAL GAPS & DETACHED VOWELS)
function sanitizeIndicText(text) {
    if (!text) return '';
    return String(text)
        .replace(/जादु\s+ई/g, 'जादुई')
        .replace(/हु\s+ई/g, 'हुई')
        .replace(/ग\s+ई/g, 'गई')
        .replace(/आ\s+ई/g, 'आई')
        .replace(/उन्हों\s+ने/g, 'उन्होंने')
        .replace(/उन्\s+होंने/g, 'उन्होंने')
        .replace(/प्\s+यारे/g, 'प्यारे')
        .replace(/तुम्\s+हारी/g, 'तुम्हारी')
        .replace(/तुम्\s+हारा/g, 'तुम्हारा')
        .replace(/मुस्\s+कुरा/g, 'मुस्कुरा')
        .replace(/श\s+क्ति/g, 'शक्ति')
        .replace(/\s+([,।!?])/g, '$1')
        .trim();
}

async function embedLanguageFont(pdfDoc, fontPath) {
    const fontBytes = fs.readFileSync(fontPath);
    const font = await pdfDoc.embedFont(fontBytes);
    if (font && font.embedder && font.embedder.font && font.embedder.font.numGlyphs) {
        const fkFont = font.embedder.font;
        const allGlyphs = [];
        for (let id = 0; id < fkFont.numGlyphs; id++) {
            allGlyphs.push(fkFont.getGlyph(id));
        }
        font.embedder.glyphCache.value = allGlyphs;
    }
    return font;
}

// MULTILINGUAL FONT EMBEDDING
async function getFontForLanguage(pdfDoc, lang) {
    pdfDoc.registerFontkit(fontkit);
    const l = String(lang || 'English').toLowerCase();

    try {
        if (l.includes('hindi')) {
            const p = path.join(fontsFolder, 'NotoSansDevanagari-Regular.ttf');
            if (fs.existsSync(p)) return await embedLanguageFont(pdfDoc, p);
        }
        if (l.includes('bengali') || l.includes('bangla')) {
            const p = path.join(fontsFolder, 'NotoSansBengali-Regular.ttf');
            if (fs.existsSync(p)) return await embedLanguageFont(pdfDoc, p);
        }
        if (l.includes('tamil')) {
            const p = path.join(fontsFolder, 'NotoSansTamil-Regular.ttf');
            if (fs.existsSync(p)) return await embedLanguageFont(pdfDoc, p);
        }
        if (l.includes('telugu')) {
            const p = path.join(fontsFolder, 'NotoSansTelugu-Regular.ttf');
            if (fs.existsSync(p)) return await embedLanguageFont(pdfDoc, p);
        }
        if (l.includes('arabic') || l.includes('urdu')) {
            const p = path.join(fontsFolder, 'NotoSansArabic-Regular.ttf');
            if (fs.existsSync(p)) return await embedLanguageFont(pdfDoc, p);
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
    const str = sanitizeIndicText(String(text || '').trim());
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
    const cleanText = sanitizeIndicText(text);
    try {
        const w = font.widthOfTextAtSize(cleanText, size);
        page.drawText(cleanText, { x: (PAGE_W - w) / 2, y, size, font, color, opacity: opacity === undefined ? 1 : opacity });
    } catch (e) {
        try { page.drawText(cleanText, { x: 50, y, size, font, color, opacity: opacity === undefined ? 1 : opacity }); }
        catch (e2) { console.log('⚠️ drawCentered fallback notice:', e2.message); }
    }
}

// SAFE FLOW LINE: Never split non-Latin strings character-by-character to protect OpenType ligatures!
function drawFlowLine(page, text, y, size, font, color, wave) {
    if (isNonLatin(text)) {
        // Whole-string drawing allows fontkit's OpenType shaper to connect ligatures correctly
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

// VECTOR DRAWING HELPERS (ELIMINATES EMOJI [][][][] TOFU BLOCKS)
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

// ====================================================================
// HARFBUZZ / CHROMIUM HIGH-FIDELITY TYPOGRAPHY ENGINE (INDIC & COMPLEX SCRIPTS)
// ====================================================================
function rgbToHex(c) {
    if (!c) return '#000000';
    const r = Math.round(((c.red !== undefined ? c.red : c.r) ?? 0) * 255).toString(16).padStart(2, '0');
    const g = Math.round(((c.green !== undefined ? c.green : c.g) ?? 0) * 255).toString(16).padStart(2, '0');
    const b = Math.round(((c.blue !== undefined ? c.blue : c.b) ?? 0) * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
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

async function renderCoverCompositePng(bgBuffer, vigBuffer, childName, bookTitle, pal, lang = 'en') {
    const width = 600;
    const height = 800;
    const accentHex = rgbToHex(pal.accent);
    const bgHex = rgbToHex(pal.cover);

    try {
        // 1. Base background layer
        const base = await sharp(bgBuffer).resize(width, height, { fit: 'cover' }).toBuffer();

        // 2. Circular Child Medallion Hero (315x315 pt safe zone)
        const medalSize = 315;
        const medalRadius = medalSize / 2;
        const circleSvg = Buffer.from(
            `<svg width="${medalSize}" height="${medalSize}"><circle cx="${medalRadius}" cy="${medalRadius}" r="${medalRadius}" fill="#fff"/></svg>`
        );
        const circularMedallion = await sharp(vigBuffer)
            .resize(medalSize, medalSize, { fit: 'cover' })
            .composite([{ input: circleSvg, blend: 'dest-in' }])
            .png()
            .toBuffer();

        // 3. Clean Typography & Safe-Zone Spacing
        const nonLatin = isNonLatin(childName + (bookTitle || ''));
        const topLabel = nonLatin ? childName : `${childName}'s`;
        const cleanName = escapeXml(sanitizeIndicText(topLabel));
        const cleanTitle = escapeXml(sanitizeIndicText(bookTitle || `${childName}'s Adventure`));

        const fontFamilies = nonLatin
            ? "'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Arabic', 'Nirmala UI', sans-serif"
            : "'Playfair Display', Georgia, 'Times New Roman', serif";

        // Balanced title wrap
        const words = cleanTitle.split(' ');
        let line1 = cleanTitle;
        let line2 = '';
        if (words.length > 3 && cleanTitle.length > 24) {
            const mid = Math.ceil(words.length / 2);
            line1 = words.slice(0, mid).join(' ');
            line2 = words.slice(mid).join(' ');
        }

        const titleSvg = line2
            ? `<text x="${width / 2}" y="660" text-anchor="middle" fill="#FFFFFF" font-family="${fontFamilies}" font-size="28" font-weight="800" filter="drop-shadow(0 2px 10px rgba(0,0,0,0.95))">${line1}</text>
               <text x="${width / 2}" y="700" text-anchor="middle" fill="#FFFFFF" font-family="${fontFamilies}" font-size="28" font-weight="800" filter="drop-shadow(0 2px 10px rgba(0,0,0,0.95))">${line2}</text>`
            : `<text x="${width / 2}" y="675" text-anchor="middle" fill="#FFFFFF" font-family="${fontFamilies}" font-size="${nonLatin ? 32 : 34}" font-weight="800" filter="drop-shadow(0 2px 10px rgba(0,0,0,0.95))">${line1}</text>`;

        const overlaySvg = Buffer.from(`
          <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <!-- Outer glowing ring -->
            <circle cx="${width / 2}" cy="${height / 2}" r="${medalRadius + 6}" fill="none" stroke="${accentHex}" stroke-width="2.5" opacity="0.85"/>
            <!-- Inner gold border ring -->
            <circle cx="${width / 2}" cy="${height / 2}" r="${medalRadius}" fill="none" stroke="${accentHex}" stroke-width="4.5"/>

            <!-- Top Child Name -->
            <text x="${width / 2}" y="115" text-anchor="middle" fill="${accentHex}" font-family="${fontFamilies}" font-size="${nonLatin ? 40 : 42}" font-weight="700" ${nonLatin ? '' : 'font-style="italic" letter-spacing="1.5"'} filter="drop-shadow(0 2px 8px rgba(0,0,0,0.9))">
              ${cleanName}
            </text>

            <!-- Lower Book Title -->
            ${titleSvg}

            <!-- Bottom Keepsake Banner -->
            <text x="${width / 2}" y="755" text-anchor="middle" fill="${accentHex}" font-family="${fontFamilies}" font-size="11" font-style="italic" opacity="0.9">
              TwinkleTale Keepsake Treasury
            </text>
          </svg>
        `);

        const medalTop = Math.round((height - medalSize) / 2);
        const medalLeft = Math.round((width - medalSize) / 2);

        return await sharp(base)
            .composite([
                { input: circularMedallion, top: medalTop, left: medalLeft },
                { input: overlaySvg, top: 0, left: 0 }
            ])
            .png()
            .toBuffer();
    } catch (err) {
        console.error("❌ Sharp cover composite error:", err.message);
        return null;
    }
}

async function renderVersePagePng(title, bodyText, options = {}) {
    const width = 480;
    const height = 360;
    const titleColor = options.titleColor || '#1e3799';
    const accentColor = options.accentColor || '#c8963e';
    const textColor = options.textColor || '#2d3436';

    const cleanTitle = escapeXml(sanitizeIndicText(title));
    const cleanBody = sanitizeIndicText(bodyText);
    const rawLines = cleanBody.split('\n').filter(Boolean).map(l => escapeXml(l.trim()));

    const fontFamilies = "'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Arabic', 'Nirmala UI', sans-serif";

    try {
        let linesSvg = '';
        let startY = rawLines.length > 3 ? 150 : 175;
        rawLines.forEach((line, idx) => {
            linesSvg += `<text x="${width / 2}" y="${startY + idx * 34}" text-anchor="middle" fill="${textColor}" font-family="${fontFamilies}" font-size="19" font-weight="500">${line}</text>`;
        });

        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          ${cleanTitle ? `<text x="${width / 2}" y="75" text-anchor="middle" fill="${titleColor}" font-family="${fontFamilies}" font-size="26" font-weight="700">${cleanTitle}</text>
          <polygon points="${width / 2},105 ${width / 2 + 5},110 ${width / 2},115 ${width / 2 - 5},110" fill="${accentColor}" />` : ''}
          ${linesSvg}
        </svg>`;

        return await sharp(Buffer.from(svg)).png().toBuffer();
    } catch (e) {
        console.warn('⚠️ Sharp verse page render notice:', e.message);
        return null;
    }
}

async function renderCoverTitlePng(name, title, options = {}) {
    const width = 540;
    const height = 180;
    const accentColor = options.accentColor || '#f9ca24';
    const titleColor = options.titleColor || '#ffffff';

    const cleanName = escapeXml(sanitizeIndicText(name));
    const cleanTitle = escapeXml(sanitizeIndicText(title));

    const fontFamilies = "'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Arabic', 'Nirmala UI', sans-serif";

    try {
        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          ${cleanName ? `<text x="${width / 2}" y="70" text-anchor="middle" fill="${accentColor}" font-family="${fontFamilies}" font-size="38" font-weight="700">${cleanName}</text>` : ''}
          <text x="${width / 2}" y="${cleanName ? 130 : 100}" text-anchor="middle" fill="${titleColor}" font-family="${fontFamilies}" font-size="32" font-weight="800">${cleanTitle}</text>
        </svg>`;
        return await sharp(Buffer.from(svg)).png().toBuffer();
    } catch (e) {
        console.warn('⚠️ Sharp cover title render notice:', e.message);
        return null;
    }
}

async function renderDedicationBlockPng(title, rhyme, forLabel, dedMsg, options = {}) {
    const width = 500;
    const height = 480;
    const accent = options.accentColor || '#c8963e';
    const ink = options.inkColor || '#1e272e';
    const cover = options.coverColor || '#1e3799';

    const cleanTitle = escapeXml(sanitizeIndicText(title));
    const cleanRhyme = sanitizeIndicText(rhyme);
    const cleanFor = escapeXml(sanitizeIndicText(forLabel));
    const cleanMsg = sanitizeIndicText(dedMsg);

    const fontFamilies = "'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Arabic', 'Nirmala UI', sans-serif";

    try {
        const rhymeLines = cleanRhyme.split('\n').filter(Boolean).map(l => escapeXml(l.trim()));
        let rhymeSvg = '';
        rhymeLines.forEach((l, i) => {
            rhymeSvg += `<text x="${width / 2}" y="${160 + i * 26}" text-anchor="middle" fill="${ink}" font-family="${fontFamilies}" font-size="14" font-weight="500" font-style="italic">${l}</text>`;
        });

        const dedLines = cleanMsg.split('\n').filter(Boolean).map(l => escapeXml(l.trim()));
        let dedSvg = '';
        const dedStartY = 160 + rhymeLines.length * 26 + 65;
        dedLines.forEach((l, i) => {
            dedSvg += `<text x="${width / 2}" y="${dedStartY + i * 24}" text-anchor="middle" fill="${ink}" font-family="${fontFamilies}" font-size="13" font-weight="400">${l}</text>`;
        });

        const divY = 160 + rhymeLines.length * 26 + 20;

        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <text x="${width / 2}" y="45" text-anchor="middle" fill="${accent}" font-family="${fontFamilies}" font-size="11" font-weight="700" letter-spacing="2">TWINKLETALE KEEPSAKE TREASURY</text>
          <polygon points="${width / 2},60 ${width / 2 + 4},64 ${width / 2},68 ${width / 2 - 4},64" fill="${accent}" />
          <text x="${width / 2}" y="105" text-anchor="middle" fill="${cover}" font-family="${fontFamilies}" font-size="24" font-weight="700">${cleanTitle}</text>
          ${rhymeSvg}
          <line x1="${width / 2 - 130}" y1="${divY}" x2="${width / 2 + 130}" y2="${divY}" stroke="${accent}" stroke-width="1" opacity="0.5" />
          <text x="${width / 2}" y="${divY + 30}" text-anchor="middle" fill="${cover}" font-family="${fontFamilies}" font-size="16" font-weight="700">${cleanFor}</text>
          ${dedSvg}
        </svg>`;

        return await sharp(Buffer.from(svg)).png().toBuffer();
    } catch (e) {
        console.warn('⚠️ Sharp dedication render notice:', e.message);
        return null;
    }
}

// WHIMSICAL STORYBOOK AVATAR (GHIBLI / WATERCOLOR PICTURE BOOK STYLE)
async function generateAvatar(photoData, charAnchor) {
    if (photoData) {
        try {
            console.log("  → Transforming reference photo into rich painterly storybook avatar via flux-kontext-pro...");
            const avatarPrompt = `Transform the child in this photo into an adorable, charming storybook hero in lush painterly storybook realism, soft digital gouache and fine oils texture, gentle cinematic golden lighting. Soulful sparkling dark eyes with lifelike reflection, natural soft dimensional skin tones with warm peachy glow, sweet button nose, joyful happy smile, finely rendered silky hair strands catching the rim light. Capture the child's exact hairstyle, hair color, eye shape, and sweet expression faithfully, rendered with rich picture book artistry. Not flat 2D cartoon, not stiff 3D CGI, not plastic, no text, no watermark`;
            const out = await replicate.run("black-forest-labs/flux-kontext-pro", {
                input: {
                    input_image: photoData,
                    prompt: avatarPrompt,
                    output_format: "png"
                }
            });
            const u = extractUrl(out);
            if (u) return u;
        } catch (e) {
            console.log("    ⚠️ Avatar transformation fallback notice:", e.message);
        }
    }

    console.log("  → Painting rich storybook portrait via flux-1.1-pro...");
    const prompt = STYLE + `portrait of ${charAnchor} as an adorable storybook hero, soft warm studio lighting, cheerful expression, rich painterly storybook illustration, clean soft background`;
    const out = await replicate.run("black-forest-labs/flux-1.1-pro", {
        input: { prompt: prompt, aspect_ratio: "1:1", output_format: "png" }
    });
    return extractUrl(out);
}

// THEME-RELEVANT ORNATE COVER BACKGROUND (WITH THEME-SPECIFIC BORDER & DEDICATED TEXT SAFE ZONES)
async function generateCoverBackground(base, pal) {
    console.log(`  → Painting ornate theme-specific border background for ${base} theme with dedicated text safe zones...`);
    const borderDetail = pal.borderDesc || `ornate storybook border with subtle ${pal.motifs} strictly along the outer perimeter edges and four corners only`;
    const bgPrompt = `Masterpiece luxury book cover background, rich digital gouache and fine artisan texture: solid flat ${pal.flatWord} background with an ${borderDetail}; the entire wide central area, the entire upper text area, and the entire lower title area are completely empty, blank, uniform ${pal.flatWord} with zero ornaments, zero leaves, zero flowers, zero vines, zero stars, zero arches, and zero lines; clean minimalist dark field inside an ornate theme-specific outer border frame; no characters, no people, no words, no text, no letters, no watermark, no inner frames, no lines cutting through the center or bottom`;
    return await generateImage(bgPrompt, null);
}

// THEME-RELEVANT CHILD MEDALLION HERO
async function generateChildMedallion(charAnchor, base, pal, photoData) {
    console.log(`  → Painting child medallion hero for ${base} theme...`);
    if (photoData) {
        return await generateAvatar(photoData, charAnchor);
    }
    const vigPrompt = STYLE + `circular painted vignette portrait of ${charAnchor} as the storybook hero, head and shoulders, joyful expression, soft golden rim light, a few tiny ${pal.motifs} sparkles around the head, surrounded by ${pal.flatWord} background filling all four corners, vignette edges softly fading into that flat background`;
    return await generateImage(vigPrompt, null);
}

// FULL-BLEED STORYBOOK COVER PAINTING (FALLBACK / BESPOKE)
async function generateCoverPainting(charAnchor, base, pal, photoData, bespokePrompt) {
    console.log(`  → Painting full-bleed storybook cover for ${base} theme...`);
    const prompt = bespokePrompt
        ? (STYLE + bespokePrompt)
        : (STYLE + `full-bleed children's book cover illustration of ${charAnchor} as the joyful adventure hero exploring a breathtaking, magical ${base} world with ${pal.motifs}; child is smiling warmly in the lower-center of the scene; wide open tranquil uncluttered empty ${pal.flatWord} sky in the upper third of the composition, pure background art, warm magical volumetric golden hour lighting, rich digital gouache and fine oils texture, painterly storybook realism, masterpiece picture book cover, no text, no words, no letters, no title, no typography, no watermark, no border, no frame`);
    return await generateImage(prompt, photoData);
}

const QUALITY_SUFFIX = ' Composition: full-bleed page art, subject on rule-of-thirds, eye-level camera for child subjects, strong silhouette readability. Micro-detail: crisp fabric weave, individual hair strands, tiny specular highlights in eyes. Print finish: gallery-grade print quality, clean anti-aliased edges, no banding, no compression artifacts, no oversharpening.';
let bookUpscalesCount = 0;

// UPSCALE CHAIN (CLARITY-UPSCALER -> REAL-ESRGAN -> NATIVE FALLBACK)
async function upscaleImageWithFallback(url) {
    const cleanUrl = extractUrl(url);
    if (!cleanUrl) return url;

    // a) philz1337x/clarity-upscaler with 1 retry (2 attempts total)
    try {
        const out = await withRetry('clarity upscaler', async () => {
            return await replicate.run("philz1337x/clarity-upscaler:dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e", {
                input: {
                    image: cleanUrl,
                    creativity: 0.3,
                    resemblance: 0.85,
                    scale: 4,
                    output_format: 'jpg'
                }
            });
        }, 2, 3000);
        const upscaledUrl = extractUrl(out);
        if (upscaledUrl) {
            console.log("⬆️ 4K upscale via philz1337x/clarity-upscaler");
            bookUpscalesCount++;
            await sleep(PACING);
            return upscaledUrl;
        }
    } catch (errA) {
        console.log("    (clarity upscaler notice, falling back to real-esrgan):", errA.message);
    }

    // b) nightmareai/real-esrgan
    try {
        const out = await replicate.run("nightmareai/real-esrgan", {
            input: {
                image: cleanUrl,
                scale: 4
            }
        });
        const upscaledUrl = extractUrl(out);
        if (upscaledUrl) {
            console.log("⬆️ 4K upscale via nightmareai/real-esrgan");
            bookUpscalesCount++;
            await sleep(PACING);
            return upscaledUrl;
        }
    } catch (errB) {
        console.log("    (real-esrgan notice, falling back to native):", errB.message);
    }

    // c) original url (graceful degradation)
    console.warn("⚠️ upscale fallback to native");
    return cleanUrl;
}

async function generateImage(prompt, photoData) {
    const finalPrompt = prompt + QUALITY_SUFFIX;
    let rawUrl = '';

    if (photoData) {
        try {
            const out = await replicate.run("black-forest-labs/flux-kontext-pro", {
                input: {
                    input_image: photoData,
                    prompt: finalPrompt,
                    aspect_ratio: "3:4",
                    output_format: "png",
                    safety_tolerance: 2
                }
            });
            rawUrl = extractUrl(out);
        } catch (e) {
            console.log("    (face model notice, falling back to non-photo model):", e.message);
        }
    }

    if (!rawUrl) {
        const model = process.env.IMAGE_GEN_MODEL;
        if (model === 'google/nano-banana-pro') {
            const out = await replicate.run("google/nano-banana-pro", {
                input: { prompt: finalPrompt, resolution: '4K', aspect_ratio: '3:4' }
            });
            rawUrl = extractUrl(out);
        } else if (model === 'black-forest-labs/flux-2-pro') {
            const out = await replicate.run("black-forest-labs/flux-2-pro", {
                input: { prompt: finalPrompt, aspect_ratio: "3:4", output_format: "png" }
            });
            rawUrl = extractUrl(out);
        } else {
            const out = await replicate.run("black-forest-labs/flux-1.1-pro", {
                input: { prompt: finalPrompt, aspect_ratio: "3:4", output_format: "png" }
            });
            rawUrl = extractUrl(out);
        }
    }

    if (process.env.UPSCALE_IMAGES !== 'false' && rawUrl) {
        rawUrl = await upscaleImageWithFallback(rawUrl);
    }
    return rawUrl;
}

async function fetchImageBuffer(url) {
    const cleanUrl = extractUrl(url);
    const res = await axios.get(cleanUrl, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(res.data);
}

async function embedImageBuffer(pdfDoc, buf, label = 'image') {
    let img;
    try { img = await pdfDoc.embedPng(buf); }
    catch (e) { img = await pdfDoc.embedJpg(buf); }

    if (img && img.width) {
        const dpi = Math.round(img.width / 8.333);
        console.log(`  🖼️ [${label}] Embedded resolution: ${img.width}x${img.height}px | Effective print DPI: ~${dpi}`);
        if (process.env.UPSCALE_IMAGES !== 'false' && dpi < 300) {
            console.warn(`  ⚠️ [${label}] DPI warning: Effective DPI is ${dpi} (< 300 target).`);
        }
    }
    return img;
}

// ====================================================================
// STORY COMPLETION ENGINE: SARVAM AI (INDIC) + DEEPSEEK (GLOBAL & FALLBACK)
// ====================================================================
async function callStoryLLM(systemPrompt, userPrompt, lang) {
    const isIndic = /hindi|bengali|bangla|tamil|telugu|urdu/i.test(String(lang || ''));
    if (isIndic && process.env.SARVAM_API_KEY) {
        try {
            console.log(`🇮🇳 Calling Sarvam AI (sarvam-105b) for authentic ${lang} storytelling...`);
            const sarvamRes = await axios.post('https://api.sarvam.ai/v1/chat/completions', {
                model: 'sarvam-105b',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 4096,
                reasoning_effort: null,
                response_format: { type: 'json_object' }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'api-subscription-key': process.env.SARVAM_API_KEY,
                    'Authorization': `Bearer ${process.env.SARVAM_API_KEY}`
                },
                timeout: 45000
            });
            const content = sarvamRes.data?.choices?.[0]?.message?.content;
            if (content) {
                console.log(`✅ Sarvam AI successfully generated story in ${lang}!`);
                return content;
            }
        } catch (sarvamErr) {
            console.warn(`⚠️ Sarvam AI notice (${sarvamErr.message}), falling back to DeepSeek...`);
        }
    }

    // Default & Fallback: DeepSeek Chat
    console.log(`🌐 Calling DeepSeek (deepseek-chat) for ${lang}...`);
    const deepseekRes = await axios.post('https://api.deepseek.com/v1/chat/completions', {
        model: 'deepseek-chat',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        timeout: 45000
    });
    return deepseekRes.data?.choices?.[0]?.message?.content || '';
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
        const { genderClean, childAge, pronoun, subjectPronoun, charAnchor } = getCharacterDetails(childName, gender, age, theme);

        const base = String(theme || 'Story').split(' (')[0];
        const pal = themeKit(base);
        assertZones();

        console.log(`✨ Preview | ${childName} (${genderClean}, ${childAge}) | ${base} | Lang=${lang}`);

        // Step 1: LLM story outline, unique title, opening rhyme & 4K bespoke visual prompts
        const genderGuidance = (genderClean === 'little star')
            ? `The child is non-binary / gender-neutral (Little Star). Use gentle, gender-inclusive wording, using they/them pronouns or referring warmly to ${childName}.`
            : `The child protagonist is ${childName}, a ${childAge}-year-old ${genderClean} (${pronoun}/${subjectPronoun}).`;

        const systemPrompt = `You are an award-winning children's storybook author and visual art director for TwinkleTale. Output ONLY a valid JSON object with keys:
"book_title": (a unique, poetic, charming 3-5 word storybook title in ${lang} specifically tailored to ${childName}'s bedtime adventure in ${theme}, e.g. "${childName} और जादुई डॉल्फ़िन" or "${childName} and the Starlight Voyage"),
"opening_rhyme": (4 lines of lyrical, warm read-aloud rhyme welcoming ${childName} into their bedtime adventure in ${lang}),
"cover_image_prompt": (a detailed 70-90 word visual art prompt in English describing the front cover painting in rich stylized painterly realism: describe ${charAnchor} as the cheerful hero actively interacting with a breathtaking, magical ${theme} world with ${pal.motifs}; child has soulful sparkling eyes and a warm joyful expression; upper third of scene has a wide open, tranquil, completely empty blank pastel sky with soft floating clouds and gentle starlight, pure background art with NO text, NO words, NO letters, NO name, NO typography; cinematic volumetric golden hour lighting, gentle rim light, rich digital gouache and fine oils texture),
"story_scenes": (an array of 12 objects, each with "scene_title" [2-4 words in ${lang}], "page_text" [35-50 words in ${lang}], and "image_prompt" [an active, evocative 70-90 word visual art prompt in English describing ${charAnchor} actively interacting with the world in this scene (e.g., reaching out with wonder, holding glowing starlight motes in palms, exploring beside friendly companion creatures, gazing through portals, discovering hidden treasures); soulful sparkling eyes, natural dimensional skin tones with gentle peachy warmth, cinematic lighting, rich depth of field, atmospheric magical embers, painterly storybook realism; NEVER include any child's name in image_prompt]).
${genderGuidance}
LANGUAGE REQUIREMENT: All child-facing text ("book_title", "opening_rhyme", "scene_title", "page_text") MUST be written beautifully in ${lang} using its authentic script. All visual prompts ("cover_image_prompt", "image_prompt") MUST be in English. No markdown, no commentary.`;
        const userPrompt = `Create an enchanting ${theme} bedtime storybook for ${childName} in ${lang}.`;

        const rawStoryText = await withRetry('preview story outline', () => callStoryLLM(systemPrompt, userPrompt, lang), 2, 3000);
        let storyText = rawStoryText.replace(/```json/g, '').replace(/```/g, '').trim();
        const storyJson = JSON.parse(storyText);
        const bookTitle = (storyJson.book_title && storyJson.book_title.trim()) || `${childName}'s ${themeTitle(base)}`;
        const openingRhyme = storyJson.opening_rhyme || `Underneath the twinkling stars, where dreams begin to play,\nA special tale unfolds tonight, to softly guide your way.\nFor ${childName}, our little dreamer, so brave and kind and bright,\nA magical bedtime story starts before you sleep tonight.`;
        const scenesData = Array.isArray(storyJson.story_scenes) ? storyJson.story_scenes : [];

        // Step 2: Generate Theme Border Background & Child Medallion Hero with rate pacing
        console.log("  → Painting theme-relevant ornate border background...");
        const bgUrlRaw = await withRetry('cover background', async () => generateCoverBackground(base, pal));
        await sleep(PACING);

        console.log("  → Painting child medallion hero...");
        const vigUrlRaw = await withRetry('child medallion hero', async () => generateChildMedallion(charAnchor, base, pal, photoData));

        const [bgBuffer, vigBuffer] = await Promise.all([
            fetchImageBuffer(bgUrlRaw),
            fetchImageBuffer(vigUrlRaw)
        ]);

        // Step 3: Composite into unified, non-overlapping high-resolution cover
        console.log("  → Compositing theme-framed cover with non-overlapping typography...");
        let coverBuffer = await renderCoverCompositePng(bgBuffer, vigBuffer, childName, bookTitle, pal, lang);
        let coverIsComposited = true;
        if (!coverBuffer) {
            console.warn("⚠️ Sharp cover composite notice, falling back to background buffer");
            coverBuffer = bgBuffer;
            coverIsComposited = false;
        }

        const previewId = `prev_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        // Disk persistence for bulletproof preview-to-final book locking
        try {
            fs.writeFileSync(path.join(booksFolder, `preview_${previewId}_cover.png`), coverBuffer);
        } catch (fsErr) {
            console.warn('⚠️ Could not cache preview cover to disk:', fsErr.message);
        }

        let coverPublicUrl = `${req.protocol}://${req.get('host')}/books/preview_${previewId}_cover.png`;
        if (supabase) {
            try {
                const coverFileName = `preview_${previewId}_cover.png`;
                const up = await supabase.storage.from('storybooks').upload(coverFileName, coverBuffer, { contentType: 'image/png', upsert: true });
                if (!up.error) {
                    coverPublicUrl = supabase.storage.from('storybooks').getPublicUrl(coverFileName).data.publicUrl;
                }
            } catch (sErr) {
                console.warn('⚠️ Supabase cover upload notice:', sErr.message);
            }
        }

        previewSessions.set(previewId, {
            previewId,
            timestamp: Date.now(),
            childName, gender: genderClean, age: childAge, theme, language: lang,
            photoData, dedication, email,
            charAnchor, pronoun, subjectPronoun, pal,
            title: bookTitle, bookTitle,
            coverUrl: coverPublicUrl,
            coverIsComposited,
            // Buffers are saved to disk (preview_${previewId}_cover.png) to keep RAM usage under 15MB
            coverBuffer: null,
            bgUrl: coverPublicUrl, vigUrl: coverPublicUrl,
            scenesData, openingRhyme,
            coverImagePrompt: storyJson.cover_image_prompt
        });

        console.log(`✅ Preview created in ${((Date.now() - t0) / 1000).toFixed(1)}s (id: ${previewId}, title: "${bookTitle}", url: ${coverPublicUrl})`);

        res.json({
            success: true,
            previewId,
            childName,
            gender: genderClean,
            age: childAge,
            language: lang,
            bookTitle,
            openingRhyme,
            coverDataUrl: coverPublicUrl,
            coverUrl: coverPublicUrl,
            // Backwards compatibility fields
            vignetteDataUrl: coverPublicUrl,
            coverBgDataUrl: coverPublicUrl,
            vignetteUrl: coverPublicUrl,
            coverBgUrl: coverPublicUrl
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
        if (!session && !String(previewId || '').startsWith('test_')) {
            return res.status(404).json({ success: false, error: 'Preview session expired. Please preview your book again.' });
        }

        const isLong = String(bookLength || '').toLowerCase().includes('long') || String(bookLength || '').includes('24');
        const amountPaise = isLong ? 29900 : 19900;

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
            email,
            coverDataUrl
        } = req.body;

        let session = previewSessions.get(previewId);

        // Bulletproof session recovery (in case Render worker recycled between preview and payment)
        if (!session) {
            const diskCoverPath = path.join(booksFolder, `preview_${previewId}_cover.png`);
            let coverBuf = null;
            if (fs.existsSync(diskCoverPath)) {
                coverBuf = fs.readFileSync(diskCoverPath);
            } else if (coverDataUrl && typeof coverDataUrl === 'string' && coverDataUrl.startsWith('http')) {
                try {
                    coverBuf = await fetchImageBuffer(coverDataUrl);
                } catch (fetchErr) {
                    console.warn('⚠️ Could not fetch cover from URL:', fetchErr.message);
                }
            } else if (coverDataUrl && typeof coverDataUrl === 'string' && coverDataUrl.startsWith('data:')) {
                coverBuf = Buffer.from(coverDataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            }

            if (coverBuf) {
                console.log(`♻️ Recovering preview session from disk/client for ${previewId}...`);
                session = {
                    previewId,
                    childName: 'Child',
                    gender: 'little star',
                    age: 5,
                    theme: 'Story',
                    language: 'English',
                    coverBuffer: coverBuf,
                    coverUrl: coverDataUrl || '',
                    email: email || '',
                    charAnchor: 'adorable child with rosy cheeks and sweet smile in cozy storybook watercolor style',
                    pal: themeKit('Story'),
                    title: 'Treasury of Wonderful Stories',
                    bookTitle: 'Treasury of Wonderful Stories',
                    scenesData: []
                };
            } else {
                return res.status(404).json({ success: false, error: 'Preview session expired or not found' });
            }
        }

        // Lock the exact preview cover approved by the parent if not already in session buffer
        if (!session.coverBuffer) {
            const diskCoverPath = path.join(booksFolder, `preview_${previewId}_cover.png`);
            if (fs.existsSync(diskCoverPath)) {
                session.coverBuffer = fs.readFileSync(diskCoverPath);
            } else if (coverDataUrl && typeof coverDataUrl === 'string' && coverDataUrl.startsWith('http')) {
                try {
                    session.coverBuffer = await fetchImageBuffer(coverDataUrl);
                } catch (e) {}
            } else if (coverDataUrl && typeof coverDataUrl === 'string' && coverDataUrl.startsWith('data:')) {
                session.coverBuffer = Buffer.from(coverDataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            }
        }
        if (session.coverBuffer) {
            console.log('🔒 Exact approved preview cover locked for final book!');
        }

        // =========================================================
        // HACK-PROOF RAZORPAY VERIFICATION & ANTI-REPLAY CHECK
        // =========================================================
        if (razorpay && process.env.RAZORPAY_KEY_SECRET) {
            if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
                return res.status(400).json({ success: false, error: 'Incomplete payment credentials received from gateway.' });
            }

            // Anti-Replay Guard: Reject if payment ID was already redeemed
            if (fulfilledPayments.has(razorpay_payment_id)) {
                return res.status(400).json({ success: false, error: 'This payment has already been verified and processed. Please check your email for the download link.' });
            }

            // 1. Timing-Safe HMAC-SHA256 Cryptographic Verification (prevents side-channel timing attacks)
            const expectedSig = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex');

            const expectedBuf = Buffer.from(expectedSig, 'utf8');
            const providedBuf = Buffer.from(String(razorpay_signature || ''), 'utf8');
            if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
                return res.status(400).json({ success: false, error: 'Payment signature verification failed. Tampered payload detected.' });
            }

            // 2. Direct Razorpay Gateway API Audit (Double Verification against real funds captured)
            try {
                const payment = await razorpay.payments.fetch(razorpay_payment_id);
                if (!payment || (payment.status !== 'captured' && payment.status !== 'authorized')) {
                    return res.status(400).json({ success: false, error: `Payment not confirmed by Razorpay gateway (status: ${payment?.status || 'unknown'}).` });
                }
                if (payment.order_id !== razorpay_order_id) {
                    return res.status(400).json({ success: false, error: 'Payment order ID mismatch.' });
                }
                const isLong = String(bookLength || '').toLowerCase().includes('long') || String(bookLength || '').includes('24');
                const minExpectedPaise = isLong ? 29900 : 19900;
                if (payment.amount < minExpectedPaise) {
                    return res.status(400).json({ success: false, error: 'Paid amount is less than the required book edition price.' });
                }
            } catch (fetchErr) {
                console.error('❌ Razorpay server audit error:', fetchErr.message);
                return res.status(400).json({ success: false, error: 'Failed to verify transaction status directly with Razorpay.' });
            }

            // Mark payment as fulfilled to prevent re-submissions
            fulfilledPayments.set(razorpay_payment_id, Date.now());
            console.log(`💳 Cryptographically Verified & Settled: ${razorpay_payment_id} for order ${razorpay_order_id}`);
        } else {
            // In Production, reject unconfigured gateways immediately
            if (process.env.NODE_ENV === 'production') {
                return res.status(503).json({ success: false, error: 'Razorpay payment gateway is not configured for production transactions.' });
            }
            console.log(`💳 Test Payment simulated in dev mode: ${razorpay_payment_id || 'test_payment'}`);
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
        const base = String(theme || 'Story').split(' (')[0];

        const scenes = getSceneCount(bookLength);
        console.log(`📖 Async Assembly Job ${jobId} | ${childName} | scenes=${scenes} | Lang=${language}`);
        const startUpscales = bookUpscalesCount;

        const pdfDoc = await PDFDocument.create();
        pdfDoc.setTitle(`${childName}'s ${title}`);
        pdfDoc.setAuthor('TwinkleTale');
        pdfDoc.setSubject(`A personalized keepsake bedtime storybook for ${childName}`);
        pdfDoc.setCreator('TwinkleTale Studios AI');

        const bookFont = await getFontForLanguage(pdfDoc, language);
        const serifBI = await pdfDoc.embedFont('Times-BoldItalic');
        const serifB = await pdfDoc.embedFont('Times-Bold');
        const serifI = await pdfDoc.embedFont('Times-Italic');
        const serif = await pdfDoc.embedFont('Times-Roman');

        update(20, 'Painting decorative chapter borders...');
        const framePrompt = STYLE + `decorative rectangular border frame for a children's book page, repeating hand-painted motifs of ${pal.motifs} woven with ribbons and leaves around all four edges, wide plain warm cream empty center occupying seventy percent of the page, soft pastel palette, gentle textures`;
        const frameImgBuffer = await withRetry('frame image', async () => fetchImageBuffer(await generateImage(framePrompt, null)));
        const frameImg = await embedImageBuffer(pdfDoc, frameImgBuffer, 'decorative frame');
        await sleep(PACING);

        // ================= PAGE 1: FRONT COVER (THEME BORDER & MEDALLION) =================
        update(30, 'Binding theme-framed front cover...');
        let coverImgBuffer = session.coverBuffer;
        if (!coverImgBuffer && session.previewId) {
            const diskCoverPath = path.join(booksFolder, `preview_${session.previewId}_cover.png`);
            if (fs.existsSync(diskCoverPath)) {
                coverImgBuffer = fs.readFileSync(diskCoverPath);
            }
        }
        if (!coverImgBuffer) {
            console.log("  → Cover buffer not cached in session, generating theme border & child medallion...");
            const bgUrlRaw = await withRetry('cover background', async () => generateCoverBackground(base, pal));
            await sleep(PACING);
            const vigUrlRaw = await withRetry('child medallion hero', async () => generateChildMedallion(charAnchor, base, pal, photoData));
            const [bgBuffer, vigBuffer] = await Promise.all([
                fetchImageBuffer(bgUrlRaw),
                fetchImageBuffer(vigUrlRaw)
            ]);
            coverImgBuffer = await renderCoverCompositePng(bgBuffer, vigBuffer, childName, session.bookTitle || title, pal, language);
            if (!coverImgBuffer) {
                coverImgBuffer = bgBuffer;
                session.coverIsComposited = false;
                session.bgBuffer = bgBuffer;
                session.vigBuffer = vigBuffer;
            } else {
                session.coverIsComposited = true;
            }
        }

        const cover = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });

        if (session.coverIsComposited !== false && coverImgBuffer) {
            // High-resolution unified cover composite (identical to approved preview)
            const coverImg = await embedImageBuffer(pdfDoc, coverImgBuffer, 'cover');
            cover.drawImage(coverImg, coverFit(coverImg, PAGE_W, PAGE_H));
        } else {
            // Fallback: draw theme border, child medallion, and non-overlapping typography via pdf-lib
            if (session.bgBuffer) {
                const bgImg = await embedImageBuffer(pdfDoc, session.bgBuffer, 'cover_bg');
                cover.drawImage(bgImg, coverFit(bgImg, PAGE_W, PAGE_H));
            } else if (coverImgBuffer) {
                const coverImg = await embedImageBuffer(pdfDoc, coverImgBuffer, 'cover');
                cover.drawImage(coverImg, coverFit(coverImg, PAGE_W, PAGE_H));
            }

            if (session.vigBuffer) {
                const vigImg = await embedImageBuffer(pdfDoc, session.vigBuffer, 'cover_vig');
                const d = Z.medal.r * 2;
                const fit = coverFit(vigImg, d, d);
                const dx = (Z.medal.cx - Z.medal.r) + fit.x;
                const dy2 = (Z.medal.cy - Z.medal.r) + fit.y;
                cover.drawImage(vigImg, { x: dx, y: dy2, width: fit.width, height: fit.height });
                cover.drawEllipse({ x: Z.medal.cx, y: Z.medal.cy, xScale: Z.medal.r + 5, yScale: Z.medal.r + 5, borderColor: pal.accent, borderWidth: 3.5 });
                cover.drawEllipse({ x: Z.medal.cx, y: Z.medal.cy, xScale: Z.medal.r + 11, yScale: Z.medal.r + 11, borderColor: pal.accent, borderWidth: 1.5, borderOpacity: 0.7 });
            }

            // Top Name Plaque (y ≈ 715 pt, framed by top foliage arch)
            const topLabel = isNonLatin(childName) ? `${childName}` : `${childName}'s`;
            const topFont = chooseFont(topLabel, bookFont, serifBI);
            drawFlowLine(cover, topLabel, 715, 42, topFont, pal.accent, 2);

            // Lower Title (y ≈ 285 pt, safely below medallion - ZERO OVERLAP)
            const bookTitle = session.bookTitle || title || `${childName}'s Adventure`;
            const titleFont = chooseFont(bookTitle, bookFont, serifB);
            let tSize = 36;
            let tLines = wrapText(bookTitle, titleFont, tSize, 470);
            if (tLines.length > 3) { tSize = 30; tLines = wrapText(bookTitle, titleFont, tSize, 470); }
            let ty = 285;
            for (const line of tLines) {
                drawFlowLine(cover, line, ty, tSize, titleFont, rgb(0.99, 0.98, 0.94), 2.5);
                ty -= 42;
            }

            // Bottom Keepsake Banner (Safe print margin at y = 45 pt)
            drawCentered(cover, 'TwinkleTale Keepsake Treasury', 45, 11, serifI, pal.accent, 0.95);
            drawVectorStar(cover, PAGE_W / 2 - 115, 45, 5, 5, 2.2, pal.accent);
            drawVectorStar(cover, PAGE_W / 2 + 115, 45, 5, 5, 2.2, pal.accent);
        }

        // ================= PAGE 2: WELCOME & DEDICATION (INSIDE FRONT SPREAD) =================
        update(33, 'Crafting welcome dedication page...');
        const dedPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        dedPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
        dedPage.drawImage(frameImg, coverFit(frameImg, PAGE_W, PAGE_H));

        // Book Title & Dedication in Authentic Language
        const dedTitle = session.bookTitle || title || `${childName}'s Adventure`;
        const rhyme = session.openingRhyme || `Underneath the twinkling stars, where dreams begin to play,\nA special tale unfolds tonight, to softly guide your way.\nFor ${childName}, our little dreamer, so brave and kind and bright,\nA magical bedtime story starts before you sleep tonight.`;
        const forLabel = isNonLatin(childName) ? `खास तौर पर ${childName} के लिए` : `Especially for ${childName}`;
        const dedMsg = (dedication && dedication.trim())
            ? dedication.trim()
            : `May this bedtime story remind you, every single night, just how hugely loved and cherished you are. Dream big, little star!`;

        let dedRendered = false;
        if (isNonLatin(dedTitle) || isNonLatin(rhyme) || isNonLatin(dedMsg) || isNonLatin(childName)) {
            const dedBuf = await renderDedicationBlockPng(dedTitle, rhyme, forLabel, dedMsg, {
                accentColor: rgbToHex(pal.accent),
                inkColor: rgbToHex(pal.ink),
                coverColor: rgbToHex(pal.cover)
            });
            if (dedBuf) {
                const dedImg = await pdfDoc.embedPng(dedBuf);
                dedPage.drawImage(dedImg, {
                    x: (PAGE_W - 500) / 2,
                    y: 200,
                    width: 500,
                    height: 480
                });
                dedRendered = true;
            }
        }
        if (!dedRendered) {
            // Top Header
            drawCentered(dedPage, 'TWINKLETALE KEEPSAKE TREASURY', 665, 10, serifB, pal.accent, 0.95);
            drawVectorDiamond(dedPage, PAGE_W / 2, 648, 6, pal.accent);

            const dedTitleFont = chooseFont(dedTitle, bookFont, serifB);
            let dtSize = 26;
            let dtLines = wrapText(dedTitle, dedTitleFont, dtSize, 420);
            if (dtLines.length > 2) { dtSize = 22; dtLines = wrapText(dedTitle, dedTitleFont, dtSize, 420); }
            let dty = 612;
            for (const line of dtLines) {
                drawCentered(dedPage, line, dty, dtSize, dedTitleFont, pal.cover);
                dty -= 34;
            }

            const rhymeFont = chooseFont(rhyme, bookFont, serifI);
            const rhymeLines = wrapText(rhyme, rhymeFont, 14, 400);
            let ry = dty - 16;
            for (const line of rhymeLines) {
                drawCentered(dedPage, line, ry, 14, rhymeFont, pal.ink, 0.9);
                ry -= 24;
            }

            // Golden divider
            dedPage.drawLine({ start: { x: 140, y: ry - 12 }, end: { x: PAGE_W - 140, y: ry - 12 }, color: pal.accent, thickness: 1, opacity: 0.6 });
            drawVectorStar(dedPage, PAGE_W / 2, ry - 12, 5, 8, 3.5, pal.accent);

            // Personalized Parent Dedication Block
            const dedForFont = chooseFont(forLabel, bookFont, serifB);
            drawCentered(dedPage, forLabel, ry - 40, 16, dedForFont, pal.cover);

            const dedMsgFont = chooseFont(dedMsg, bookFont, serifI);
            const dedMsgLines = wrapText(dedMsg, dedMsgFont, 13, 390);
            let my = ry - 68;
            for (const line of dedMsgLines) {
                drawCentered(dedPage, line, my, 13, dedMsgFont, pal.ink, 0.85);
                my -= 22;
            }
        }

        // Keepsake footer
        drawCentered(dedPage, 'TwinkleTale Studios • Keepsake Treasury Edition', 70, 9, serif, pal.ink, 0.6);

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

            // Use DeepSeek bespoke 4K visual prompt if provided, ensuring child's name is never passed to diffusion model
            let rawPrompt = scene.image_prompt || `${charAnchor} with a joyful smile in the scene: ${scene.scene_title}`;
            if (childName && childName.length > 1) {
                const nameRegex = new RegExp(`\\b${childName}\\b`, 'gi');
                rawPrompt = rawPrompt.replace(nameRegex, (gender === 'little star') ? 'the child' : `the little ${gender || 'hero'}`);
            }
            const scenePrompt = STYLE + rawPrompt;
            const sceneImgBuf = await withRetry(`scene ${i + 1} image`, async () => fetchImageBuffer(await generateImage(scenePrompt, photoData)));
            const sceneImg = await embedImageBuffer(pdfDoc, sceneImgBuf, `scene ${i + 1}`);

            // LEFT PAGE: Full-bleed Scene Illustration
            const imgPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            imgPage.drawImage(sceneImg, coverFit(sceneImg, PAGE_W, PAGE_H));

            // RIGHT PAGE: Framed Verse Page
            const textPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            textPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
            textPage.drawImage(frameImg, coverFit(frameImg, PAGE_W, PAGE_H));

            // Verse Page Content (HarfBuzz rendering for Indic & complex scripts, vector for Latin)
            let verseRendered = false;
            if (isNonLatin(scene.page_text) || isNonLatin(scene.scene_title)) {
                const versePngBuf = await renderVersePagePng(scene.scene_title, scene.page_text, {
                    titleColor: rgbToHex(pal.cover),
                    accentColor: rgbToHex(pal.accent),
                    textColor: rgbToHex(pal.ink)
                });
                if (versePngBuf) {
                    const versePngImg = await pdfDoc.embedPng(versePngBuf);
                    textPage.drawImage(versePngImg, {
                        x: (PAGE_W - 480) / 2,
                        y: 290,
                        width: 480,
                        height: 360
                    });
                    verseRendered = true;
                }
            }
            if (!verseRendered) {
                // Scene Title (Multilingual font routing)
                const sceneTitleFont = chooseFont(scene.scene_title, bookFont, serifB);
                drawCentered(textPage, scene.scene_title, 610, 26, sceneTitleFont, pal.cover);
                drawVectorDiamond(textPage, PAGE_W / 2, 576, 8, pal.cover);

                // Verse Text (Multilingual font routing)
                const verseFont = chooseFont(scene.page_text, bookFont, serif);
                const verseLines = wrapText(scene.page_text, verseFont, 18, 400);
                let by = 520 - ((520 - 180) - verseLines.length * 32) / 2;
                for (const line of verseLines) {
                    drawCentered(textPage, line, by, 18, verseFont, pal.ink);
                    by -= 32;
                }
            }

            // Spread Number (ALWAYS rendered with serif to prevent fontkit tofu blocks)
            drawCentered(textPage, `— ${spreadIndex} —`, 100, 12, serif, pal.ink, 0.75);
            spreadIndex++;

            if (i < scenes - 1) {
                console.log("  ⏳ Pacing 10s...");
                await sleep(PACING);
            }
        }

        // ================= FINAL PAGE: ENDING KEEPSAKE PAGE =================
        update(95, 'Sealing book keepsake ending page...');
        const endPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        endPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawFrameVectors(endPage, pal);

        // Golden seal star at the top center
        drawVectorStar(endPage, PAGE_W / 2, 680, 5, 20, 9, pal.accent);

        // Title
        drawCentered(endPage, 'TwinkleTale', 630, 28, serifBI, pal.accent);
        drawCentered(endPage, 'Personalized Keepsake Treasury', 604, 13, serifI, rgb(0.95, 0.95, 0.95), 0.9);

        // Horizontal divider with small gold diamonds
        endPage.drawLine({ start: { x: 120, y: 575 }, end: { x: PAGE_W - 120, y: 575 }, color: pal.accent, thickness: 1, opacity: 0.6 });
        drawVectorDiamond(endPage, PAGE_W / 2, 575, 8, pal.accent);

        // Bedtime Blessing Block
        const forText = `Sleep With The Stars, ${childName}`;
        const blessTitleFont = chooseFont(forText, bookFont, serifB);
        drawCentered(endPage, forText, 525, 20, blessTitleFont, pal.accent);

        const closingBlessing = `May your dreams tonight take you on wondrous journeys across starlit skies and enchanted lands. Rest your eyes, little adventurer, knowing you are deeply loved, hugely cherished, and capable of wonderful things.`;
        const blessFont = chooseFont(closingBlessing, bookFont, serifI);
        const blessLines = wrapText(closingBlessing, blessFont, 16, 420);
        let dy = 470;
        for (const line of blessLines) {
            drawCentered(endPage, line, dy, 16, blessFont, rgb(0.98, 0.98, 0.98), 0.95);
            dy -= 26;
        }

        // Closing bedtime wish
        const closingWish = 'Every child is the hero of their own bedtime story.';
        drawCentered(endPage, closingWish, Math.min(dy - 20, 310), 13, serifI, rgb(0.90, 0.90, 0.90), 0.85);

        // Gold seal with vector stars
        const sealY = 210;
        endPage.drawCircle({ x: PAGE_W / 2, y: sealY, size: 45, borderColor: pal.accent, borderWidth: 2 });
        endPage.drawCircle({ x: PAGE_W / 2, y: sealY, size: 41, borderColor: pal.accent, borderWidth: 1, borderOpacity: 0.7 });
        drawVectorStar(endPage, PAGE_W / 2, sealY, 5, 14, 6, pal.accent);
        drawCentered(endPage, 'OFFICIAL KEEPSAKE', sealY - 26, 8, serifB, pal.accent, 0.9);

        // Footer
        const yr = new Date().getFullYear();
        drawCentered(endPage, `Handcrafted with love • ${yr} • All Rights Reserved`, 100, 10, serif, pal.accent, 0.75);

        // ================= FINAL PAGE: OFFICIAL KEEPSAKE BACK COVER =================
        update(96, 'Binding official keepsake back cover...');
        const backCover = pdfDoc.addPage([PAGE_W, PAGE_H]);
        backCover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawFrameVectors(backCover, pal);

        // Central gold seal
        drawVectorStar(backCover, PAGE_W / 2, 530, 5, 24, 11, pal.accent);
        drawCentered(backCover, 'TwinkleTale', 480, 26, serifBI, pal.accent);
        drawCentered(backCover, 'Personalized Keepsake Storybooks', 455, 12, serifI, rgb(0.95, 0.95, 0.95), 0.9);

        backCover.drawLine({ start: { x: 160, y: 425 }, end: { x: PAGE_W - 160, y: 425 }, color: pal.accent, thickness: 1, opacity: 0.6 });
        drawVectorDiamond(backCover, PAGE_W / 2, 425, 7, pal.accent);

        drawCentered(backCover, '"Every child is the hero of their own bedtime story."', 385, 13, serifI, rgb(0.92, 0.92, 0.92), 0.85);
        const backHeroTag = `Handcrafted with love for ${childName}`;
        drawCentered(backCover, backHeroTag, 355, 12, chooseFont(backHeroTag, bookFont, serifB), pal.accent, 0.9);

        drawCentered(backCover, 'A Keepsake Treasury To Treasure Forever', 160, 11, serifI, pal.accent, 0.85);
        drawCentered(backCover, 'www.twinkletaleai.com • Keepsake Edition', 60, 10, serif, pal.accent, 0.7);

        // ================= STRICT PAGE COUNT GUARDRAIL (PRINT-SHOP MULTIPLES OF 4) =================
        const expectedPages = (scenes * 2) + 4;
        if (pdfDoc.getPageCount() !== expectedPages) {
            throw new Error(`PAGE COUNT GUARDRAIL VIOLATION: Expected exactly ${expectedPages} pages but generated ${pdfDoc.getPageCount()}`);
        }

        // ================= SAVE & UPLOAD =================
        update(97, 'Saving print-ready PDF...');
        const pdfBytes = await pdfDoc.save();
        const safeName = String(childName).replace(/[^a-zA-Z0-9_-]/g, '_');
        const cryptToken = crypto.randomBytes(16).toString('hex');
        const fileName = `twinkletale_${safeName}_${cryptToken}.pdf`;
        let pdfUrl = null;

        if (supabase) {
            try {
                const up = await supabase.storage.from('storybooks').upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: false });
                if (!up.error) pdfUrl = supabase.storage.from('storybooks').getPublicUrl(fileName).data.publicUrl;
                console.log("☁️ Saved permanently to Supabase:", pdfUrl);
            } catch (e) {
                console.log("⚠️ Supabase upload notice:", e.message);
                pdfUrl = null;
            }
        }
        if (!pdfUrl) {
            fs.writeFileSync(path.join(booksFolder, fileName), pdfBytes);
            pdfUrl = `${protocol}://${host}/books/${fileName}`;
            console.log("💾 Saved locally:", pdfUrl);
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
        const jobUpscales = bookUpscalesCount - startUpscales;
        const estUpscaleCost = (jobUpscales * 0.04).toFixed(2);
        console.log(`💰 Estimated upscale cost for Job ${jobId}: $${estUpscaleCost} (${jobUpscales} upscales used x ~$0.04)`);
        console.log(`🎉 Job ${jobId} Completed! Pages=${pdfDoc.getPageCount()} | PDF: ${pdfUrl}`);
    } catch (err) {
        console.error(`❌ Job ${jobId} Failed:`, err.message);
        const job = activeJobs.get(jobId);
        if (job) {
            job.status = 'failed';
            job.error = err.message;
            job.step = 'Generation encountered an error';
        }
    } finally {
        if (session) {
            session.photoData = null; // Ephemeral photo memory purged immediately for child privacy
        }
    }
}

// ====================================================================
// DIRECT BOOK GENERATION (RESTRICTED TO ADMIN / DEV)
// ====================================================================
app.post('/api/create-book', rateLimiter, async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        const adminToken = req.headers['x-admin-token'] || req.query.admin_token;
        if (!process.env.ADMIN_TOKEN || adminToken !== process.env.ADMIN_TOKEN) {
            return res.status(403).json({ success: false, error: 'Direct creation is restricted in production. Please use /api/create-preview and verified checkout.' });
        }
    }
    const t0 = Date.now();
    try {
        const { childName, gender, age, theme, language, photoData, bookLength, dedication, email } = req.body;
        if (!childName) return res.status(400).json({ success: false, error: 'Child name is required' });

        const lang = String(language || 'English').trim();
        const { genderClean, childAge, pronoun, subjectPronoun, charAnchor } = getCharacterDetails(childName, gender, age, theme);

        const base = String(theme || 'Story').split(' (')[0];
        const scenes = getSceneCount(bookLength);
        const pal = themeKit(base);
        const title = themeTitle(base);
        assertZones();

        console.log(`📘 Direct Book | ${childName} (${genderClean}, ${childAge}) | ${base} | Lang=${lang}`);

        const genderGuidance = (genderClean === 'little star')
            ? `The child is non-binary / gender-neutral (Little Star). Use gender-inclusive wording with they/them or ${childName}.`
            : `The child protagonist is ${childName}, a ${childAge}-year-old ${genderClean} (${pronoun}/${subjectPronoun}).`;

        const systemPrompt = `You are an award-winning children's storybook author for TwinkleTale. Output ONLY a valid JSON object with key "scenes": an array of ${scenes} objects. No markdown, no extra text.
${genderGuidance}
Each object in "scenes" must have "scene_title" (2-4 words in ${lang}), "page_text" (35-50 words in ${lang}), and "image_prompt" (one detailed sentence in English describing ${charAnchor}).
Write all scene text in ${lang} using its authentic script.`;
        const userPrompt = `Write a ${scenes}-scene bedtime story for ${childName} in ${lang} about ${theme}.`;

        const rawStoryText = await withRetry('story', () => callStoryLLM(systemPrompt, userPrompt, lang), 2, 3000);

        let storyText = rawStoryText.replace(/```json/g, '').replace(/```/g, '').trim();
        let parsed = JSON.parse(storyText);
        let rawPages = Array.isArray(parsed) ? parsed : (parsed.scenes || parsed.story_scenes || []);
        const pages = (Array.isArray(rawPages) ? rawPages : []).slice(0, scenes);

        console.log("  → Painting theme-relevant ornate border background...");
        const bgUrlRaw = await withRetry('cover background', async () => generateCoverBackground(base, pal));
        await sleep(PACING);
        console.log("  → Painting child medallion hero...");
        const vigUrlRaw = await withRetry('child medallion hero', async () => generateChildMedallion(charAnchor, base, pal, photoData));
        const [bgBuffer, vigBuffer] = await Promise.all([
            fetchImageBuffer(bgUrlRaw),
            fetchImageBuffer(vigUrlRaw)
        ]);

        let coverBuffer = await renderCoverCompositePng(bgBuffer, vigBuffer, childName, title, pal, lang);
        let coverIsComposited = true;
        if (!coverBuffer) {
            coverBuffer = bgBuffer;
            coverIsComposited = false;
        }

        const session = {
            childName, gender: genderClean, age: childAge, theme, language: lang,
            photoData, dedication, email,
            charAnchor, pronoun, subjectPronoun, pal,
            title, bookTitle: title,
            coverBuffer, bgBuffer, vigBuffer,
            coverIsComposited,
            scenesData: pages
        };

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 TwinkleTale Server running on port ${PORT}`));