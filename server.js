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
// Strictly disable sharp cache, cap concurrency to 1, and disable simd to guarantee memory stays <150MB
sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);
console.log(`🚀 Process Memory Limits: max-old-space-size=280MB | global.gc=${typeof global.gc === 'function' ? 'enabled' : 'disabled'}`);

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
app.get('/favicon.ico', (req, res) => res.status(204).end());

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
function sanitizeSupabaseUrl(raw) {
    if (!raw) return '';
    const clean = String(raw).trim().replace(/^["']|["']$/g, '');
    try {
        const parsed = new URL(clean);
        return parsed.origin;
    } catch (_) {
        return clean.replace(/\/+$/, '').replace(/\/rest\/v1\/?$/, '').replace(/\/storage\/v1\/?$/, '');
    }
}
const cleanSupabaseUrl = sanitizeSupabaseUrl(process.env.SUPABASE_URL);
const cleanSupabaseKey = String(process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/^["']|["']$/g, '');
if (cleanSupabaseUrl && cleanSupabaseKey) {
    supabase = createClient(cleanSupabaseUrl, cleanSupabaseKey);
    console.log(`☁️ Supabase permanent storage: ON (${cleanSupabaseUrl})`);
    // Ensure bucket exists or auto-create 'storybooks'
    ensureSupabaseBucket();
} else {
    console.log('⚠️ Supabase not configured — using local storage fallback');
}

// Auto-provision and verify Supabase storage bucket
async function ensureSupabaseBucket() {
    if (!supabase) return;
    try {
        const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
        if (listErr) {
            console.error('❌ [SUPABASE] Bucket list check error:', listErr.message || listErr);
            return;
        }
        const bucketNames = (buckets || []).map(b => b.name);
        console.log(`☁️ [SUPABASE] Accessible buckets: [${bucketNames.join(', ')}]`);
        if (!bucketNames.includes('storybooks')) {
            console.log('☁️ [SUPABASE] Bucket "storybooks" not found. Auto-creating public bucket...');
            const { data, error: createErr } = await supabase.storage.createBucket('storybooks', {
                public: true,
                fileSizeLimit: 104857600 // 100MB
            });
            if (createErr) {
                console.error('❌ [SUPABASE] Failed to create bucket "storybooks":', createErr.message || createErr);
            } else {
                console.log('✅ [SUPABASE] Bucket "storybooks" created successfully with public access!');
            }
        } else {
            console.log('✅ [SUPABASE] Storage bucket "storybooks" is verified and active.');
        }
    } catch (err) {
        console.error('❌ [SUPABASE] Bucket initialization exception:', err.message);
    }
}

// Unified robust cloud storage upload with retry and auto-recovery
async function uploadToStorage(fileName, fileBuffer, contentType = 'application/pdf') {
    if (!supabase) return null;
    try {
        let up = await supabase.storage.from('storybooks').upload(fileName, fileBuffer, {
            contentType,
            upsert: true
        });

        // Auto-recovery if bucket was missing
        if (up && up.error && String(up.error.message || '').toLowerCase().includes('bucket not found')) {
            console.log('☁️ [SUPABASE] Bucket missing during upload. Attempting auto-creation...');
            await supabase.storage.createBucket('storybooks', { public: true, fileSizeLimit: 104857600 });
            up = await supabase.storage.from('storybooks').upload(fileName, fileBuffer, {
                contentType,
                upsert: true
            });
        }

        if (up && up.error) {
            console.error(`❌ [SUPABASE] Storage upload failed for ${fileName}:`, up.error.message || up.error);
            return null;
        }

        // Generate 30-day (2,592,000s) pre-signed URL & public URL
        let signedUrl = null;
        try {
            const signedRes = await supabase.storage.from('storybooks').createSignedUrl(fileName, 2592000);
            if (signedRes?.data?.signedUrl) {
                signedUrl = signedRes.data.signedUrl;
            }
        } catch (_) {}

        let publicUrl = null;
        try {
            const pubRes = supabase.storage.from('storybooks').getPublicUrl(fileName);
            if (pubRes?.data?.publicUrl) {
                publicUrl = pubRes.data.publicUrl;
            }
        } catch (_) {}

        const finalUrl = signedUrl || publicUrl;
        console.log(`☁️ [SUPABASE] Permanently stored ${fileName} -> ${finalUrl ? 'OK' : 'FAIL'}`);
        return { success: true, fileName, signedUrl, publicUrl, finalUrl };
    } catch (err) {
        console.error(`❌ [SUPABASE] Storage exception for ${fileName}:`, err.message);
        return null;
    }
}

// Email delivery
let mailer = null;
const cleanBrevoKey = String(process.env.BREVO_API_KEY || '').trim().replace(/^["']|["']$/g, '');
const cleanSenderEmail = String(process.env.SENDER_EMAIL || '').trim().replace(/^["']|["']$/g, '');
if (cleanBrevoKey && cleanSenderEmail) {
    mailer = {
        sendMail: async ({ to, subject, html, text }) => {
            try {
                await axios.post('https://api.brevo.com/v3/smtp/email', {
                    sender: { name: 'TwinkleTale', email: cleanSenderEmail },
                    to: [{ email: String(to || '').trim() }],
                    subject: subject,
                    htmlContent: html || `<p>${text}</p>`
                }, { 
                    headers: { 'api-key': cleanBrevoKey, 'Content-Type': 'application/json' },
                    timeout: 8000
                });
            } catch (mailErr) {
                const brevoErr = mailErr.response?.data?.message || mailErr.message;
                const statusCode = mailErr.response?.status || 'network';
                console.warn(`⚠️ [BREVO] Email delivery notice (${brevoErr}) [HTTP ${statusCode}]. Link delivery remains active.`);
                throw mailErr; // allow caller to catch
            }
        }
    };
    console.log('📧 Email delivery: ON (Brevo HTTPS)');
} else {
    console.log('⚠️ Brevo not configured — link-only delivery');
}

// Image Generation Pipeline Versioning (v2 default, with v1 instant rollback via GEN_PIPELINE_VERSION=v1)
const PIPELINE_VERSION = process.env.GEN_PIPELINE_VERSION || 'v2';
const IS_V2 = PIPELINE_VERSION !== 'v1';
console.log(`🚀 Image Generation Pipeline: ${PIPELINE_VERSION.toUpperCase()} (v1 rollback available via GEN_PIPELINE_VERSION=v1)`);

// Cover Pipeline Versioning (v2 reimagined default, with v1 instant rollback via COVER_PIPELINE_VERSION=v1)
const { CoverDesignEngine } = require('./lib/cover/coverEngine');
const { extractPhotoVisualAttributes } = require('./lib/vision/attributeExtractor');
const { createCharacterProfile } = require('./lib/character/characterProfile');
const { getOrGenerateCharacterMaster } = require('./lib/character/characterMaster');
const { getOrGenerateCharacterSheet } = require('./lib/character/characterSheet');
const { validateImageQuality, PageRegenerationBudget, MAX_PAGE_QUALITY_REGENERATIONS } = require('./lib/character/characterQA');
const { OrderGenerationManifest } = require('./lib/observability/generationManifest');

const COVER_PIPELINE_VERSION = process.env.COVER_PIPELINE_VERSION || 'v2';
const IS_COVER_V2 = COVER_PIPELINE_VERSION !== 'v1';
const CHARACTER_PIPELINE_VERSION = process.env.CHARACTER_PIPELINE_VERSION || 'v2';
const UPSCALE_POLICY = process.env.UPSCALE_POLICY || 'threshold'; // 'threshold' (Sharp local default) | 'ai' | 'disabled'
console.log(`🎨 Book Cover Pipeline: ${COVER_PIPELINE_VERSION.toUpperCase()} (v1 rollback available via COVER_PIPELINE_VERSION=v1)`);
console.log(`👤 Character Master Pipeline: ${CHARACTER_PIPELINE_VERSION.toUpperCase()} | Upscale Policy: ${UPSCALE_POLICY}`);

const coverEngine = new CoverDesignEngine({
    generateImage: (prompt, photoData, options) => generateImage(prompt, photoData, options),
    generateAvatar: (photoData, charAnchor, attributes) => generateAvatar(photoData, charAnchor, attributes),
    fetchImageBuffer: (url) => fetchImageBuffer(url)
});

// ====================================================================
// REGIONAL MARKET & MULTI-CURRENCY PRICING CONFIGURATION
// IN: Domestic India (Paise, INR)
// US: United States (Cents, USD)
// ====================================================================
const MARKET_CONFIG = {
    IN: {
        currency: 'INR',
        symbol: '₹',
        short: {
            offerPriceSubunits: 9900,   // ₹99 (special offer)
            priceSubunits: 19900        // ₹199 (standard MSRP)
        },
        long: {
            offerPriceSubunits: 19900,  // ₹199 (special offer)
            priceSubunits: 29900        // ₹299 (standard MSRP)
        }
    },
    US: {
        currency: 'USD',
        symbol: '$',
        short: {
            offerPriceSubunits: 599,    // $5.99 (50% launch promo, regular $11.99)
            priceSubunits: 1199         // $11.99 (regular MSRP)
        },
        long: {
            offerPriceSubunits: 1199,   // $11.99 (50% launch promo, regular $23.99)
            priceSubunits: 2399         // $23.99 (regular MSRP)
        }
    }
};

function resolveMarketKey(body = {}, session = {}) {
    const rawMarket = String(body.market || session.market || '').toUpperCase();
    const rawCurrency = String(body.currency || session.currency || '').toUpperCase();
    if (rawMarket === 'US' || rawCurrency === 'USD') return 'US';
    return 'IN';
}

function computeEditionSubunits(marketKey, isLong, isOffer) {
    const market = MARKET_CONFIG[marketKey] || MARKET_CONFIG.IN;
    const tier = isLong ? market.long : market.short;
    return isOffer ? tier.offerPriceSubunits : tier.priceSubunits;
}

const booksFolder = path.join(__dirname, 'books');
if (!fs.existsSync(booksFolder)) fs.mkdirSync(booksFolder);

const fontsFolder = path.join(__dirname, 'fonts');
if (!fs.existsSync(fontsFolder)) fs.mkdirSync(fontsFolder);

// Pre-cache TTF fonts as base64 for self-contained, 100% reliable SVG typography without OS font dependencies
const FONT_BASE64 = {};
try {
    const devPath = path.join(fontsFolder, 'NotoSansDevanagari-Regular.ttf');
    if (fs.existsSync(devPath)) FONT_BASE64.hindi = fs.readFileSync(devPath).toString('base64');

    const benPath = path.join(fontsFolder, 'NotoSansBengali-Regular.ttf');
    if (fs.existsSync(benPath)) FONT_BASE64.bengali = fs.readFileSync(benPath).toString('base64');

    const tamPath = path.join(fontsFolder, 'NotoSansTamil-Regular.ttf');
    if (fs.existsSync(tamPath)) FONT_BASE64.tamil = fs.readFileSync(tamPath).toString('base64');

    const telPath = path.join(fontsFolder, 'NotoSansTelugu-Regular.ttf');
    if (fs.existsSync(telPath)) FONT_BASE64.telugu = fs.readFileSync(telPath).toString('base64');

    const araPath = path.join(fontsFolder, 'NotoSansArabic-Regular.ttf');
    if (fs.existsSync(araPath)) FONT_BASE64.arabic = fs.readFileSync(araPath).toString('base64');

    console.log('🔤 Pre-cached Indic & Arabic base64 fonts for in-process Sharp rendering:', Object.keys(FONT_BASE64).join(', '));
} catch (fErr) {
    console.warn('⚠️ Could not pre-cache base64 fonts:', fErr.message);
}

function getSvgFontFaceStyle(lang = 'en', textSample = '') {
    const l = String(lang || '').toLowerCase();
    let fontFace = '';
    if (FONT_BASE64.hindi && (l.includes('hindi') || /[\u0900-\u097F]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'StoryFont'; src: url('data:font/ttf;base64,${FONT_BASE64.hindi}') format('truetype'); font-weight: 700; }\n`;
    } else if (FONT_BASE64.bengali && (l.includes('bengali') || l.includes('bangla') || /[\u0980-\u09FF]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'StoryFont'; src: url('data:font/ttf;base64,${FONT_BASE64.bengali}') format('truetype'); font-weight: 700; }\n`;
    } else if (FONT_BASE64.tamil && (l.includes('tamil') || /[\u0B80-\u0BFF]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'StoryFont'; src: url('data:font/ttf;base64,${FONT_BASE64.tamil}') format('truetype'); font-weight: 700; }\n`;
    } else if (FONT_BASE64.telugu && (l.includes('telugu') || /[\u0C00-\u0C7F]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'StoryFont'; src: url('data:font/ttf;base64,${FONT_BASE64.telugu}') format('truetype'); font-weight: 700; }\n`;
    } else if (FONT_BASE64.arabic && (l.includes('arabic') || l.includes('urdu') || /[\u0600-\u06FF]/.test(textSample))) {
        fontFace += `@font-face { font-family: 'StoryFont'; src: url('data:font/ttf;base64,${FONT_BASE64.arabic}') format('truetype'); font-weight: 700; }\n`;
    }
    return fontFace ? `<style>\n${fontFace}\n</style>` : '';
}

const PAGE_W = 600, PAGE_H = 800;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STYLE = 'Masterpiece children\'s storybook illustration, rich painterly storybook realism, soft digital gouache and fine oils texture, warm cinematic volumetric lighting, gentle golden hour rim light, adorable expressive child character with soulful sparkling dark eyes, natural soft dimensional skin tones with gentle peachy warmth, finely rendered silky hair catching the light, charming button nose and joyful smile, highly detailed enchanted surroundings with floating magical motes and glowing starlight, cinematic depth of field, art by Oliver Jeffers and Chris Van Allsburg, award-winning picture book, no text, no words, no letters, no watermark, not flat 2D cartoon, not 3D CGI plastic render: ';
const PACING = 0; // High-efficiency async dispatch (eliminates 40-90s of idle waiting)

// Preview session cache, Job status tracking, and Replay-Attack Prevention
const previewSessions = new Map();
const activeJobs = new Map();
const fulfilledPayments = new Map();

// Durable Job & Session Store Helpers (survives Render restarts, cold starts, and memory recycling)
function saveJob(jobId, jobData) {
    if (!jobId) return;
    activeJobs.set(jobId, jobData);
    try {
        fs.writeFileSync(path.join(booksFolder, `job_${jobId}.json`), JSON.stringify(jobData));
    } catch (_) {}
    if (supabase) {
        uploadToStorage(`metadata/job_${jobId}.json`, Buffer.from(JSON.stringify(jobData)), 'application/json')
            .catch(err => console.warn(`⚠️ [SUPABASE] Metadata sync notice for ${jobId}:`, err.message));
    }
}

function getJob(jobId) {
    if (!jobId) return null;
    let job = activeJobs.get(jobId);
    if (!job) {
        const jPath = path.join(booksFolder, `job_${jobId}.json`);
        if (fs.existsSync(jPath)) {
            try {
                job = JSON.parse(fs.readFileSync(jPath, 'utf8'));
                activeJobs.set(jobId, job);
            } catch (_) {}
        }
    }
    return job;
}

async function getJobAsync(jobId) {
    if (!jobId) return null;
    let job = getJob(jobId);
    if (job) return job;

    if (supabase) {
        try {
            const { data, error } = await supabase.storage.from('storybooks').download(`metadata/job_${jobId}.json`);
            if (!error && data) {
                const text = await data.text();
                job = JSON.parse(text);
                activeJobs.set(jobId, job);
                try {
                    fs.writeFileSync(path.join(booksFolder, `job_${jobId}.json`), JSON.stringify(job));
                } catch (_) {}
                console.log(`☁️ [SUPABASE] Restored Job ${jobId} from durable cloud storage!`);
                return job;
            }
        } catch (e) {
            console.warn(`⚠️ [SUPABASE] Job metadata fetch notice for ${jobId}:`, e.message);
        }
    }
    return null;
}

function saveSession(previewId, sessionData) {
    if (!previewId) return;
    // Strip giant raw image buffers from memory to keep session cache lean (<5MB)
    if (sessionData.coverBuffer) sessionData.coverBuffer = null;
    if (sessionData.bgBuffer) sessionData.bgBuffer = null;
    if (sessionData.vigBuffer) sessionData.vigBuffer = null;
    previewSessions.set(previewId, sessionData);
    try {
        // Save session metadata without giant raw buffers to prevent disk bloat
        const meta = { ...sessionData, coverBuffer: null, bgBuffer: null, vigBuffer: null };
        const metaStr = JSON.stringify(meta);
        fs.writeFileSync(path.join(booksFolder, `session_${previewId}.json`), metaStr);
        if (supabase) {
            uploadToStorage(`metadata/session_${previewId}.json`, Buffer.from(metaStr), 'application/json')
                .catch(() => {});
        }
    } catch (_) {}
}

function getSession(previewId) {
    if (!previewId) return null;
    let session = previewSessions.get(previewId);
    if (!session) {
        const sPath = path.join(booksFolder, `session_${previewId}.json`);
        if (fs.existsSync(sPath)) {
            try {
                session = JSON.parse(fs.readFileSync(sPath, 'utf8'));
                previewSessions.set(previewId, session);
            } catch (_) {}
        }
    }
    return session;
}

async function getSessionAsync(previewId) {
    if (!previewId) return null;
    let session = getSession(previewId);
    if (session) return session;

    if (supabase) {
        try {
            const { data, error } = await supabase.storage.from('storybooks').download(`metadata/session_${previewId}.json`);
            if (!error && data) {
                const text = await data.text();
                session = JSON.parse(text);
                previewSessions.set(previewId, session);
                try {
                    fs.writeFileSync(path.join(booksFolder, `session_${previewId}.json`), JSON.stringify(session));
                } catch (_) {}
                console.log(`☁️ [SUPABASE] Restored Session ${previewId} from durable cloud storage!`);
                return session;
            }
        } catch (_) {}
    }
    return null;
}

setInterval(() => {
    const now = Date.now();
    for (const [id, item] of previewSessions.entries()) {
        if (now - item.timestamp > 30 * 60 * 1000) {
            const inUse = (typeof bookQueue !== 'undefined' && bookQueue && bookQueue.isSessionInUse && bookQueue.isSessionInUse(id)) ||
                Array.from(activeJobs.values()).some(j => j.previewId === id && (j.status === 'generating' || j.status === 'queued'));
            if (!inUse) {
                try {
                    const fPath = path.join(booksFolder, `preview_${id}_cover.png`);
                    if (fs.existsSync(fPath)) fs.unlinkSync(fPath);
                    const sPath = path.join(booksFolder, `session_${id}.json`);
                    if (fs.existsSync(sPath)) fs.unlinkSync(sPath);
                } catch (_) {}
                previewSessions.delete(id);
            }
        }
    }
    for (const [id, item] of activeJobs.entries()) {
        // Keep order and job records for at least 30 days to support permanent download links
        if (now - (item.timestamp || 0) > 30 * 24 * 60 * 60 * 1000) {
            try {
                const jPath = path.join(booksFolder, `job_${id}.json`);
                if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
            } catch (_) {}
            activeJobs.delete(id);
        }
    }
    for (const [id, timestamp] of fulfilledPayments.entries()) {
        if (now - timestamp > 48 * 3600 * 1000) fulfilledPayments.delete(id);
    }
}, 10 * 60 * 1000);

// COVER PRINT-SAFE ZONES (UNIFIED 600x800 px TOP-LEFT GEOMETRY)
const Z = {
    canvas: { width: 600, height: 800 },
    name:   { top: 70, y: 125, bottom: 175 },
    medal:  { cx: 300, cy: 385, r: 175, top: 210, bottom: 560 },
    title:  { top: 605, y1: 635, y2: 675, bottom: 715 },
    footer: { y: 745, bottom: 775 }
};

// PDF-lib bottom-left coordinate mapping (PAGE_H = 800)
const PDF_Z = {
    medal: { cx: Z.medal.cx, cy: 800 - Z.medal.cy, r: Z.medal.r }, // cy: 415
    name:  { y: 800 - Z.name.y },                                    // y: 675
    title: { y: 800 - 650 },                                         // y: 150
    footer: { y: 800 - Z.footer.y }                                  // y: 55
};

function assertZones() {
    const ok = (Z.name.bottom < Z.medal.top - 20) &&
               (Z.medal.bottom < Z.title.top - 20) &&
               (Z.title.bottom < Z.footer.y - 15) &&
               (Z.footer.bottom <= Z.canvas.height);
    if (!ok) throw new Error('COVER GUARDRAIL VIOLATION: safe zones overlap');
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
    if (s.includes('22') || s.includes('24') || s.includes('28') || s.includes('long') || s.includes('grand')) {
        return 9; // 9 scenes = 18 interior story pages + 4 structural (cover, ded, seal, back) = 22 total pages
    }
    return 4; // 4 scenes = 8 interior story pages + 4 structural (cover, ded, seal, back) = 12 total pages (Treasury standard)
}

function getCharacterDetails(childName, gender, age, theme, attributes = {}) {
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
    let outfit = 'wearing a soft pastel mint-cream cotton t-shirt with a tiny embroidered golden star and cozy navy trousers';
    if (t.includes('ocean') || t.includes('dolphin') || t.includes('mermaid')) {
        outfit = 'wearing a cozy sea-breeze cyan star t-shirt and adventure trousers';
    } else if (t.includes('space') || t.includes('star')) {
        outfit = 'wearing a cozy midnight-blue star-patterned onesie with golden starlight trim';
    } else if (t.includes('animal') || t.includes('forest') || t.includes('safari') || t.includes('jungle')) {
        outfit = 'wearing a soft sage-green adventure vest over a cream cotton tee and khaki trousers';
    } else if (t.includes('princess') || t.includes('castle') || t.includes('kingdom') || t.includes('magic') || t.includes('fairy')) {
        outfit = 'wearing an enchanted pastel lavender tunic with tiny golden star embroidery';
    } else if (t.includes('super')) {
        outfit = 'wearing a heroic soft crimson tunic with a gentle golden sun emblem and cozy joggers';
    } else if (t.includes('dinosaur')) {
        outfit = 'wearing a warm amber-ochre explorer hoodie with little leaf patches and rolled trousers';
    } else if (t.includes('circus') || t.includes('carnival')) {
        outfit = 'wearing a festive berry-red and gold-trimmed festive tunic with playful suspenders';
    } else if (t.includes('lullaby') || t.includes('bedtime') || t.includes('cloud')) {
        outfit = 'wearing warm fluffy cloud-white bedtime pajamas sprinkled with tiny golden stars';
    }

    let headAndHairDesc = 'finely rendered natural hair with golden rim lighting';
    if (attributes && attributes.hasHeadwear) {
        const rawHeadwear = String(attributes.headwearDescription || (attributes.headwearType && attributes.headwearType !== 'none' ? attributes.headwearType : '')).trim();
        if (rawHeadwear) {
            const headwearDesc = rawHeadwear.startsWith('authentic ') ? rawHeadwear : `authentic ${rawHeadwear}`;
            headAndHairDesc = `wearing an ${headwearDesc} with golden rim lighting`;
        }
    }

    const extraFeatures = [];
    if (attributes && attributes.hasGlasses) {
        extraFeatures.push(`wearing ${attributes.glassesDescription || 'spectacles'}`);
    }
    if (attributes && attributes.skinTone) {
        extraFeatures.push(`authentic ${attributes.skinTone} skin`);
    }
    const extraFeaturesStr = extraFeatures.length > 0 ? `, ${extraFeatures.join(', ')}` : '';

    const charAnchorText = (genderClean === 'little star')
        ? `a cheerful young child hero named ${childName} with soulful sparkling dark eyes, charming button nose, joyful warm smile, ${headAndHairDesc}${extraFeaturesStr}, painterly storybook realism, ${outfit}`
        : `a cheerful young ${genderClean} named ${childName} with soulful sparkling dark eyes, charming button nose, joyful warm smile, ${headAndHairDesc}${extraFeaturesStr}, painterly storybook realism, ${outfit}`;

    const charAnchorVisual = (genderClean === 'little star')
        ? `a cheerful young child hero with soulful sparkling dark eyes, charming button nose, joyful warm smile, ${headAndHairDesc}${extraFeaturesStr}, painterly storybook realism, ${outfit}`
        : `a cheerful young ${genderClean} hero with soulful sparkling dark eyes, charming button nose, joyful warm smile, ${headAndHairDesc}${extraFeaturesStr}, painterly storybook realism, ${outfit}`;

    return { genderClean, childAge, pronoun, subjectPronoun, charAnchor: charAnchorVisual, charAnchorVisual, charAnchorText, outfit, attributes };
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

// ====================================================================
// DYNAMIC TEXT CONTRAST & READABILITY ENGINE
// Guarantees crystal-clear legibility by measuring actual background luminance
// ====================================================================
async function analyzeFrameBackground(frameBuffer) {
    try {
        const metadata = await sharp(frameBuffer).metadata();
        const width = metadata.width || 600;
        const height = metadata.height || 800;

        // Sample the central reading corridor: middle 60% horizontally, middle 50% vertically
        const extractRect = {
            left: Math.max(0, Math.round(width * 0.20)),
            top: Math.max(0, Math.round(height * 0.25)),
            width: Math.min(width, Math.round(width * 0.60)),
            height: Math.min(height, Math.round(height * 0.50))
        };

        const stats = await sharp(frameBuffer).extract(extractRect).stats();
        const rMean = stats.channels[0]?.mean ?? 250;
        const gMean = stats.channels[1]?.mean ?? 245;
        const bMean = stats.channels[2]?.mean ?? 235;

        return { r: rMean, g: gMean, b: bMean };
    } catch (e) {
        console.warn('⚠️ [Frame Luminance Notice]:', e.message);
        return { r: 250, g: 245, b: 235 }; // Default warm cream fallback
    }
}

function getContrastingTextColors(bgR, bgG, bgB, pal) {
    const rNorm = bgR / 255;
    const gNorm = bgG / 255;
    const bNorm = bgB / 255;
    // Standard relative luminance (ITU-R BT.709)
    const bgLum = 0.2126 * rNorm + 0.7152 * gNorm + 0.0722 * bNorm;

    console.log(`📖 [READABILITY ENGINE] Measured frame center luminance: ${bgLum.toFixed(3)} (RGB: ${Math.round(bgR)}, ${Math.round(bgG)}, ${Math.round(bgB)})`);

    if (bgLum < 0.48) {
        // Dark background (e.g. starry night, deep cosmic space, dark forest)
        // Switch to luminous gold accents and crisp ivory white text for 100% legibility
        return {
            isDarkBg: true,
            titleColor: pal.accent || rgb(0.98, 0.85, 0.35),
            bodyColor: rgb(0.98, 0.98, 0.98), // Pure luminous white
            accentColor: pal.accent || rgb(0.98, 0.85, 0.35),
            subtextColor: rgb(0.88, 0.88, 0.92)
        };
    } else {
        // Light background (e.g. warm cream, soft pastel, morning meadow)
        // Use deep rich cover palette and dark charcoal ink
        return {
            isDarkBg: false,
            titleColor: pal.cover || rgb(0.12, 0.18, 0.30),
            bodyColor: pal.ink || rgb(0.15, 0.18, 0.22),
            accentColor: pal.accent || rgb(0.80, 0.60, 0.20),
            subtextColor: pal.ink || rgb(0.20, 0.22, 0.26)
        };
    }
}

async function renderCoverCompositePng(bgBuffer, vigBuffer, childName, bookTitle, pal, lang = 'en') {
    const width = Z.canvas.width;
    const height = Z.canvas.height;
    const accentHex = rgbToHex(pal.accent);
    const bgHex = rgbToHex(pal.cover);

    try {
        // 1. Base background layer
        const base = await sharp(bgBuffer).resize(width, height, { fit: 'cover' }).toBuffer();

        // 2. Circular Child Medallion Hero (Central focal area strictly bounded by Z.medal safe zone)
        const medalSize = Z.medal.r * 2; // 350 px
        const medalRadius = Z.medal.r;   // 175 px
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

        const fontFaceStyle = getSvgFontFaceStyle(lang, childName + (bookTitle || ''));
        const fontFamilies = nonLatin
            ? "'StoryFont', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Arabic', 'Nirmala UI', sans-serif"
            : "'Playfair Display', Georgia, 'Times New Roman', serif";

        const medalCenterY = Z.medal.cy; // 385 px
        const medalCenterX = Z.medal.cx; // 300 px

        // Balanced title wrap
        const words = cleanTitle.split(' ');
        let line1 = cleanTitle;
        let line2 = '';
        if (words.length > 3 && cleanTitle.length > 20) {
            const mid = Math.ceil(words.length / 2);
            line1 = words.slice(0, mid).join(' ');
            line2 = words.slice(mid).join(' ');
        }

        const titleSvg = line2
            ? `<text x="${width / 2}" y="${Z.title.y1}" text-anchor="middle" fill="#FFFFFF" font-family="${fontFamilies}" font-size="26" font-weight="700" filter="drop-shadow(0 2px 8px rgba(0,0,0,0.95))">${line1}</text>
               <text x="${width / 2}" y="${Z.title.y2}" text-anchor="middle" fill="#FFFFFF" font-family="${fontFamilies}" font-size="26" font-weight="700" filter="drop-shadow(0 2px 8px rgba(0,0,0,0.95))">${line2}</text>`
            : `<text x="${width / 2}" y="650" text-anchor="middle" fill="#FFFFFF" font-family="${fontFamilies}" font-size="${nonLatin ? 30 : 32}" font-weight="700" filter="drop-shadow(0 2px 8px rgba(0,0,0,0.95))">${line1}</text>`;

        const overlaySvg = Buffer.from(`
          <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#000000" stop-opacity="0.65"/>
                <stop offset="65%" stop-color="#000000" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
              </linearGradient>
              <linearGradient id="bottomScrim" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
                <stop offset="35%" stop-color="#000000" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#000000" stop-opacity="0.8"/>
              </linearGradient>
              <radialGradient id="medalBackdrop" cx="50%" cy="50%" r="50%">
                <stop offset="70%" stop-color="#000000" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
              </radialGradient>
            </defs>
            ${fontFaceStyle}
            <!-- Vignette / Scrim Bands for 100% Guaranteed Typography Legibility -->
            <rect x="0" y="0" width="${width}" height="195" fill="url(#topScrim)"/>
            <rect x="0" y="585" width="${width}" height="215" fill="url(#bottomScrim)"/>

            <!-- Medallion Backdrop Shadow & Accent Rings -->
            <circle cx="${medalCenterX}" cy="${medalCenterY}" r="${medalRadius + 14}" fill="url(#medalBackdrop)"/>
            <circle cx="${medalCenterX}" cy="${medalCenterY}" r="${medalRadius + 6}" fill="none" stroke="${accentHex}" stroke-width="2.5" opacity="0.85"/>
            <circle cx="${medalCenterX}" cy="${medalCenterY}" r="${medalRadius}" fill="none" stroke="${accentHex}" stroke-width="4.5"/>

            <!-- Top Child Name -->
            <text x="${width / 2}" y="${Z.name.y}" text-anchor="middle" fill="${accentHex}" font-family="${fontFamilies}" font-size="${nonLatin ? 38 : 42}" font-weight="700" ${nonLatin ? '' : 'font-style="italic" letter-spacing="1.5"'} filter="drop-shadow(0 2px 8px rgba(0,0,0,0.9))">
              ${cleanName}
            </text>

            <!-- Lower Book Title -->
            ${titleSvg}

            <!-- Bottom Keepsake Banner -->
            <text x="${width / 2}" y="${Z.footer.y}" text-anchor="middle" fill="${accentHex}" font-family="${fontFamilies}" font-size="11" font-style="italic" opacity="0.85">
              ✦ TwinkleTale Keepsake Treasury ✦
            </text>
          </svg>
        `);

        const medalTop = Math.round(medalCenterY - medalRadius);
        const medalLeft = Math.round(medalCenterX - medalRadius);

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

    const fontFaceStyle = getSvgFontFaceStyle(options.lang || 'hindi', title + bodyText);
    const fontFamilies = "'StoryFont', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Arabic', 'Nirmala UI', sans-serif";

    try {
        let linesSvg = '';
        let startY = rawLines.length > 3 ? 150 : 175;
        rawLines.forEach((line, idx) => {
            linesSvg += `<text x="${width / 2}" y="${startY + idx * 34}" text-anchor="middle" fill="${textColor}" font-family="${fontFamilies}" font-size="19" font-weight="500">${line}</text>`;
        });

        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          ${fontFaceStyle}
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

    const fontFaceStyle = getSvgFontFaceStyle(options.lang || 'hindi', name + title);
    const fontFamilies = "'StoryFont', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Arabic', 'Nirmala UI', sans-serif";

    try {
        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          ${fontFaceStyle}
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

    const fontFaceStyle = getSvgFontFaceStyle(options.lang || 'hindi', title + rhyme + forLabel + dedMsg);
    const fontFamilies = "'StoryFont', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Arabic', 'Nirmala UI', sans-serif";

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
          ${fontFaceStyle}
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
async function generateAvatar(photoData, charAnchor, attributes = {}) {
    if (photoData) {
        const t0 = Date.now();
        const modelUsed = "black-forest-labs/flux-kontext-pro";
        try {
            console.log("  → Transforming reference photo into rich painterly storybook avatar via flux-kontext-pro (90-95% likeness)...");
            const rawHeadwear = (attributes && attributes.hasHeadwear)
                ? String(attributes.headwearDescription || (attributes.headwearType && attributes.headwearType !== 'none' ? attributes.headwearType : '')).trim()
                : '';
            const headwearDirective = rawHeadwear
                ? `[CRITICAL CULTURAL ACCURACY: The child is wearing an authentic ${rawHeadwear.replace(/^authentic\s+/i, '')}; faithfully preserve this exact headwear; do NOT replace the headwear with any cap, hat, or alternative covering.] `
                : `[STRICT HEADWEAR RESTRICTION: The child in the photo has natural hair with NO headwear, NO hat, NO cap. Strictly preserve their natural hair and natural hairline; absolutely NO hat, NO cap, NO headband, NO head covering.] `;
            const glassesDirective = (attributes && attributes.hasGlasses)
                ? `[CRITICAL VISUAL FEATURE: The child is wearing ${attributes.glassesDescription || 'spectacles'}; preserve the spectacles on their face.] `
                : `[STRICT EYEWEAR RESTRICTION: The child in the photo does NOT wear glasses. Strictly preserve their natural face with NO spectacles, NO glasses, NO sunglasses, NO frames.] `;
            const propsDirective = `[STRICT NO-PROPS RULE: Strictly maintain the child's physical attributes as-is from the photo without adding any extra props, costume hats, spectacles, or accessories.] `;
            const rawAvatarPrompt = `Transform the child in this photo into an adorable, charming storybook hero in lush painterly storybook realism, soft digital gouache and fine oils texture, gentle cinematic golden lighting. ${headwearDirective}${glassesDirective}${propsDirective}Preserve 90% to 95% facial likeness and exact identity of the child in the photo: accurately preserve their unique facial structure, exact eye shape, iris color, eyebrow shape, nose bridge and nose tip, mouth and lip contour, natural skin tone, hairstyle, hair texture, and natural hairline, while translating them seamlessly into rich picture-book painterly art. Centered head-and-shoulders portrait of the child in a cozy storybook adventure outfit, eye level, face fully in frame with generous margin around hair and chin, portrait orientation. Natural soft dimensional lighting, warm lifelike glow, authentic happy smile, finely rendered hair catching gentle rim light. Rich picture book artistry, digital gouache and fine oils. Not flat 2D cartoon, not stiff 3D CGI, not plastic, no text, no watermark, absolutely NO hats, NO caps, NO spectacles, NO glasses, NO sunglasses, NO extra props, NO unneeded accessories`;
            const avatarPrompt = sanitizePromptForSafety(rawAvatarPrompt);
            const out = await withRetry('avatar transformation (flux-kontext-pro)', async () => {
                return await replicate.run(modelUsed, {
                    input: {
                        input_image: photoData,
                        prompt: avatarPrompt,
                        aspect_ratio: "1:1",
                        output_format: "png",
                        safety_tolerance: 2,
                        prompt_upsampling: false
                    }
                });
            }, 2, 3000);
            const u = extractUrl(out);
            if (!u) throw new Error("Empty URL returned from avatar model");
            console.log(`📊 [IMAGE_GEN] Model: ${modelUsed} | Mode: photo-conditioned | Status: OK | Latency: ${Date.now() - t0}ms`);
            return u;
        } catch (e) {
            console.error(`📊 [IMAGE_GEN] Model: ${modelUsed} | Mode: photo-conditioned | Status: FAILED | Latency: ${Date.now() - t0}ms | Error: ${e.message}`);
            const isSensitiveError = /sensitive|E005|flagged|safety/i.test(e.message);
            if (isSensitiveError) {
                console.warn("⚠️ [AVATAR] Content moderation notice on photo, retrying with sanitized storybook portrait prompt...");
                try {
                    const safeAvatarPrompt = `Transform the child in this photo into a charming, cheerful storybook hero in lush painterly storybook realism, soft digital gouache, gentle golden lighting. Accurately preserve 90-95% facial likeness, eye shape, and authentic happy smile. Centered head-and-shoulders portrait of the child in a cozy storybook adventure outfit. Rich picture book art, no text, no watermark`;
                    const safeOut = await replicate.run(modelUsed, {
                        input: {
                            input_image: photoData,
                            prompt: safeAvatarPrompt,
                            aspect_ratio: "1:1",
                            output_format: "png",
                            safety_tolerance: 2,
                            prompt_upsampling: false
                        }
                    });
                    const safeUrl = extractUrl(safeOut);
                    if (safeUrl) {
                        console.log(`✅ [AVATAR] Sanitized recovery succeeded!`);
                        return safeUrl;
                    }
                } catch (retryErr) {
                    console.error("❌ [AVATAR] Sanitized retry failed:", retryErr.message);
                }
            }

            if (IS_V2) {
                if (isSensitiveError) {
                    throw new Error(`Photo avatar transformation failed: The uploaded photo could not be processed by the image safety filter. Please try a different clear face photo or order directly!`);
                }
                // PRD FR-4: Never silently substitute a generic face when customer uploaded a photo
                throw new Error(`Photo avatar transformation failed: ${e.message}. Please verify photo or retry.`);
            }
            console.log("    ⚠️ [V1 Fallback] Avatar transformation fallback notice:", e.message);
        }
    }

    const t0 = Date.now();
    const modelUsed = "black-forest-labs/flux-1.1-pro";
    console.log("  → Painting rich storybook portrait via flux-1.1-pro...");
    const prompt = STYLE + `portrait of ${charAnchor} as an adorable storybook hero, centered head-and-shoulders portrait with ample margin around hair and chin, soft warm studio lighting, cheerful expression, rich painterly storybook illustration, clean soft background`;
    const out = await replicate.run(modelUsed, {
        input: { prompt: prompt, aspect_ratio: "1:1", output_format: "png" }
    });
    const u = extractUrl(out);
    console.log(`📊 [IMAGE_GEN] Model: ${modelUsed} | Mode: text-to-image | Status: ${u ? 'OK' : 'FAILED'} | Latency: ${Date.now() - t0}ms`);
    return u;
}

// THEME-RELEVANT ORNATE COVER BACKGROUND (WITH THEME-SPECIFIC BORDER & DEDICATED TEXT SAFE ZONES)
async function generateCoverBackground(base, pal) {
    console.log(`  → Painting ornate theme-specific border background for ${base} theme with dedicated text safe zones...`);
    const borderDetail = pal.borderDesc || `ornate storybook border with subtle ${pal.motifs} strictly along the outer perimeter edges and four corners only`;
    const bgPrompt = `Masterpiece luxury book cover background, rich digital gouache and fine artisan texture: solid flat ${pal.flatWord} background with an ${borderDetail}; the entire wide central area, the entire upper text area, and the entire lower title area are completely empty, blank, uniform ${pal.flatWord} with zero ornaments, zero leaves, zero flowers, zero vines, zero stars, zero arches, and zero lines; clean minimalist dark field inside an ornate theme-specific outer border frame; no characters, no people, no words, no text, no letters, no watermark, no inner frames, no lines cutting through the center or bottom`;
    return await generateImage(bgPrompt, null, { isFace: false });
}

// THEME-RELEVANT CHILD MEDALLION HERO
async function generateChildMedallion(charAnchor, base, pal, photoData) {
    console.log(`  → Painting child medallion hero for ${base} theme...`);
    if (photoData) {
        return await generateAvatar(photoData, charAnchor);
    }
    const vigPrompt = STYLE + `circular painted vignette portrait of ${charAnchor} as the storybook hero, head and shoulders, joyful expression, soft golden rim light, a few tiny ${pal.motifs} sparkles around the head, surrounded by ${pal.flatWord} background filling all four corners, vignette edges softly fading into that flat background`;
    return await generateImage(vigPrompt, null, { aspect_ratio: "1:1", isFace: true });
}

// FULL-BLEED STORYBOOK COVER PAINTING (FALLBACK / BESPOKE)
async function generateCoverPainting(charAnchor, base, pal, photoData, bespokePrompt) {
    console.log(`  → Painting full-bleed storybook cover for ${base} theme...`);
    const prompt = bespokePrompt
        ? (STYLE + bespokePrompt)
        : (STYLE + `full-bleed children's book cover illustration of ${charAnchor} as the joyful adventure hero exploring a breathtaking, magical ${base} world with ${pal.motifs}; child is smiling warmly in the lower-center of the scene; wide open tranquil uncluttered empty ${pal.flatWord} sky in the upper third of the composition, pure background art, warm magical volumetric golden hour lighting, rich digital gouache and fine oils texture, painterly storybook realism, masterpiece picture book cover, no text, no words, no letters, no title, no typography, no watermark, no border, no frame`);
    return await generateImage(prompt, photoData, { isFace: true });
}

const QUALITY_SUFFIX = ' Composition: full-bleed page art, subject on rule-of-thirds, eye-level camera for child subjects, strong silhouette readability. Micro-detail: crisp fabric weave, individual hair strands, tiny specular highlights in eyes. Print finish: gallery-grade print quality, clean anti-aliased edges, no banding, no compression artifacts, no oversharpening.';
let bookUpscalesCount = 0;

const upscaledAssetsCache = new Set();

// UPSCALE CHAIN (LOCAL SHARP THRESHOLD -> REAL-ESRGAN -> CLARITY-UPSCALER -> NATIVE)
async function upscaleImageWithFallback(url, isFace = false) {
    const cleanUrl = extractUrl(url);
    if (!cleanUrl) return url;

    // Deduplication check: Never AI-upscale the same asset twice
    if (upscaledAssetsCache.has(cleanUrl)) {
        console.log(`⚡ [UPSCALE DEDUPLICATION] Asset already upscaled: ${cleanUrl}`);
        return cleanUrl;
    }

    // Policy check: If local Sharp enhancement is active, bypass cloud AI upscaler
    if (UPSCALE_POLICY === 'local' || process.env.UPSCALE_IMAGES === 'false') {
        console.log(`⚡ [UPSCALE POLICY] Local Sharp enhancement active — bypassing cloud AI upscaling.`);
        upscaledAssetsCache.add(cleanUrl);
        return cleanUrl;
    }

    // 1. High-speed 4K super-resolution via Real-ESRGAN (2-3s on Replicate, scale 4, zero facial distortion)
    try {
        const out = await replicate.run("nightmareai/real-esrgan", {
            input: {
                image: cleanUrl,
                scale: 4
            }
        });
        const upscaledUrl = extractUrl(out);
        if (upscaledUrl) {
            console.log("⬆️ 4K upscale via nightmareai/real-esrgan (scale=4, 4K super-resolution)");
            bookUpscalesCount++;
            upscaledAssetsCache.add(cleanUrl);
            upscaledAssetsCache.add(upscaledUrl);
            return upscaledUrl;
        }
    } catch (errB) {
        console.log("    (real-esrgan notice, falling back to clarity-upscaler):", errB.message);
    }

    // 2. High-fidelity diffusion fallback: philz1337x/clarity-upscaler
    const creativity = isFace ? 0.1 : 0.25;
    const resemblance = isFace ? 0.95 : 0.85;
    try {
        const out = await withRetry('clarity upscaler', async () => {
            return await replicate.run("philz1337x/clarity-upscaler:dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e", {
                input: {
                    image: cleanUrl,
                    creativity: creativity,
                    resemblance: resemblance,
                    scale: 4,
                    output_format: 'jpg'
                }
            });
        }, 1, 2000);
        const upscaledUrl = extractUrl(out);
        if (upscaledUrl) {
            console.log(`⬆️ 4K upscale via philz1337x/clarity-upscaler (isFace=${isFace})`);
            bookUpscalesCount++;
            upscaledAssetsCache.add(cleanUrl);
            upscaledAssetsCache.add(upscaledUrl);
            return upscaledUrl;
        }
    } catch (errA) {
        console.log("    (clarity upscaler notice, falling back to native):", errA.message);
    }

    // 3. Graceful degradation
    console.warn("⚠️ upscale fallback to native");
    upscaledAssetsCache.add(cleanUrl);
    return cleanUrl;
}

// EXHAUSTIVE PROMPT SAFETY SANITIZER (ALL AGES 1-10 & SENSITIVE MODERATION HEURISTICS)
function sanitizePromptForSafety(rawPrompt) {
    if (!rawPrompt || typeof rawPrompt !== 'string') return '';
    return rawPrompt
        // 1. Scrub numeric & word ages: e.g. "1-year-old", "2 years old", "3 yr old", "2yo", "age 2", "age: 2", "aged 2", etc.
        .replace(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[ -]?(years?|yrs?)[ -]?olds?\b/gi, 'young')
        .replace(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[ -]?(yo|y\.o\.)\b/gi, 'young')
        .replace(/\b(at|of)\s+(the\s+)?age[: ]+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, '')
        .replace(/\b(aged?|age)[: ]+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, '')
        // 2. Scrub baby/toddler/infant/newborn terms that trigger child sensitivity classifiers
        .replace(/\b(newborn|infant|toddler|baby|babies)\b/gi, 'child')
        // 3. Scrub clothing keywords that expose legs or trigger nudity/swim heuristics
        .replace(/\b(shorts|short pants)\b/gi, 'trousers')
        .replace(/\b(swimsuit|swim\s*wear|swim trunks|bathing suit|bikini|trunks)\b/gi, 'adventure outfit')
        .replace(/\bswim(ming|s)?\b/gi, 'exploring')
        .replace(/\b(diaper|diapers|nappy|nappies)\b/gi, 'adventure clothes')
        .replace(/\b(nightgown|nighty|nightwear)\b/gi, 'bedtime pajamas')
        .replace(/\b(underwear|undies)\b/gi, 'adventure clothes')
        // 4. Scrub skin and anatomical references
        .replace(/\bdancing on skin\b/gi, 'soft shimmering light')
        .replace(/\b(skin tones?|complexion|flesh)\b/gi, 'gentle warm glow')
        .replace(/\b(barefoot|bare legs|bare feet|bare arms|bare chest|limbs?|nude|naked)\b/gi, 'happy smile')
        // Clean up any double spaces
        .replace(/\s{2,}/g, ' ')
        .trim();
}

async function generateImage(prompt, photoData, options = {}) {
    const cleanPrompt = sanitizePromptForSafety(prompt);
    const finalPrompt = cleanPrompt + QUALITY_SUFFIX;
    let rawUrl = '';
    const isFace = !!photoData || options.isFace || false;
    const t0 = Date.now();

    if (photoData) {
        const modelUsed = "black-forest-labs/flux-kontext-pro";
        try {
            const out = await withRetry('scene generation (flux-kontext-pro)', async () => {
                const inputPayload = {
                    input_image: photoData,
                    prompt: finalPrompt,
                    aspect_ratio: options.aspect_ratio || "3:4",
                    output_format: "png",
                    safety_tolerance: 2,
                    prompt_upsampling: options.prompt_upsampling !== undefined ? options.prompt_upsampling : false
                };
                return await replicate.run(modelUsed, { input: inputPayload });
            }, 2, 3000);
            rawUrl = extractUrl(out);
            if (rawUrl) {
                console.log(`📊 [IMAGE_GEN] Model: ${modelUsed} | Mode: photo-conditioned | Status: OK | Latency: ${Date.now() - t0}ms`);
            }
        } catch (e) {
            console.error(`📊 [IMAGE_GEN] Model: ${modelUsed} | Mode: photo-conditioned | Status: FAILED | Latency: ${Date.now() - t0}ms | Error: ${e.message}`);
            const isSensitiveError = /sensitive|E005|flagged|safety/i.test(e.message);

            // Auto-recovery: If Replicate safety filter flagged the prompt, retry immediately with ultra-clean storybook prompt
            if (isSensitiveError && !rawUrl) {
                console.warn(`⚠️ [IMAGE_GEN] Content filter notice (${e.message}). Executing automated recovery with sanitized storybook prompt...`);
                try {
                    const themeName = options.theme || 'magical storybook';
                    const safeCleanPrompt = `Masterpiece children's picture book illustration, award-winning editorial painterly storybook realism, fine digital gouache: A happy young child hero wearing a cozy storybook adventure outfit, smiling with sparkling eyes in an enchanted ${themeName} setting. Soft luminous golden lighting, cheerful bedtime picture book art, no text, no watermark.`;
                    const safeOut = await replicate.run(modelUsed, {
                        input: {
                            input_image: photoData,
                            prompt: safeCleanPrompt,
                            aspect_ratio: options.aspect_ratio || "3:4",
                            output_format: "png",
                            safety_tolerance: 2,
                            prompt_upsampling: false
                        }
                    });
                    rawUrl = extractUrl(safeOut);
                    if (rawUrl) {
                        console.log(`✅ [IMAGE_GEN] Automated recovery SUCCEEDED for photo-conditioned image! Latency: ${Date.now() - t0}ms`);
                    }
                } catch (retryErr) {
                    console.error(`❌ [IMAGE_GEN] Sanitized retry failed: ${retryErr.message}`);
                }
            }

            if (!rawUrl && IS_V2) {
                if (options.upscale === false || options.allowFallback) {
                    console.warn("⚠️ [IMAGE_GEN] Photo-conditioned generation failed for interior scene, delegating to caller fallback...");
                    throw e;
                } else if (isSensitiveError) {
                    throw new Error(`Photo-conditioned image generation failed: The uploaded photo could not be processed by the image safety filter. Please try uploading a different clear photo of your child's face (such as a portrait or school photo), or choose Skip Preview to order directly!`);
                } else {
                    // PRD FR-4: Never silently fall back to non-photo text-to-image when reference photo/avatar was provided
                    throw new Error(`Photo-conditioned image generation failed: ${e.message}`);
                }
            }
            console.log("    (face model notice, V1 falling back to non-photo model):", e.message);
        }
    }

    if (!rawUrl && (!photoData || !IS_V2)) {
        const model = process.env.IMAGE_GEN_MODEL || 'black-forest-labs/flux-1.1-pro';
        try {
            let out;
            if (model === 'google/nano-banana-pro') {
                out = await replicate.run("google/nano-banana-pro", {
                    input: { prompt: finalPrompt, resolution: '4K', aspect_ratio: options.aspect_ratio || '3:4' }
                });
            } else if (model === 'black-forest-labs/flux-2-pro') {
                out = await replicate.run("black-forest-labs/flux-2-pro", {
                    input: { prompt: finalPrompt, aspect_ratio: options.aspect_ratio || "3:4", output_format: "png" }
                });
            } else {
                out = await replicate.run("black-forest-labs/flux-1.1-pro", {
                    input: { prompt: finalPrompt, aspect_ratio: options.aspect_ratio || "3:4", output_format: "png" }
                });
            }
            rawUrl = extractUrl(out);
            console.log(`📊 [IMAGE_GEN] Model: ${model} | Mode: text-to-image | Status: ${rawUrl ? 'OK' : 'FAILED'} | Latency: ${Date.now() - t0}ms`);
        } catch (e) {
            console.error(`📊 [IMAGE_GEN] Model: ${model} | Mode: text-to-image | Status: FAILED | Latency: ${Date.now() - t0}ms | Error: ${e.message}`);
            throw e;
        }
    }

    if (process.env.UPSCALE_IMAGES !== 'false' && rawUrl && options.upscale !== false) {
        rawUrl = await upscaleImageWithFallback(rawUrl, isFace);
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
    // Fast magic byte check: PNG starts with 0x89 0x50 0x4E 0x47
    const isPng = buf && buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    if (isPng) {
        try { img = await pdfDoc.embedPng(buf); }
        catch (e) { img = await pdfDoc.embedJpg(buf); }
    } else {
        try { img = await pdfDoc.embedJpg(buf); }
        catch (e) { img = await pdfDoc.embedPng(buf); }
    }

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

function getThemeTitleExample(theme, childName) {
    const t = String(theme || '').toLowerCase();
    if (t.includes('ocean') || t.includes('dolphin') || t.includes('mermaid')) {
        return `"${childName} and the Whispering Waves" or "${childName}'s Ocean Adventure"`;
    }
    if (t.includes('forest') || t.includes('animal') || t.includes('wood')) {
        return `"${childName} and the Whispering Woods" or "${childName}'s Secret Forest"`;
    }
    if (t.includes('dinosaur') || t.includes('dino')) {
        return `"${childName} and the Gentle Giant" or "${childName}'s Dinosaur Wonder"`;
    }
    if (t.includes('space') || t.includes('star') || t.includes('galaxy')) {
        return `"${childName} and the Cosmic Comet" or "${childName} and the Starlight Voyage"`;
    }
    if (t.includes('princess') || t.includes('castle') || t.includes('kingdom')) {
        return `"${childName} and the Royal Secret" or "${childName}'s Golden Palace"`;
    }
    if (t.includes('super')) {
        return `"${childName} the Brave Hero" or "${childName}'s Golden Cape"`;
    }
    if (t.includes('fairy') || t.includes('magic')) {
        return `"${childName} and the Enchanted Sprout" or "${childName}'s Fairy Garden"`;
    }
    if (t.includes('safari') || t.includes('jungle')) {
        return `"${childName}'s Jungle Adventure" or "${childName} and the Sunlit Safari"`;
    }
    if (t.includes('unicorn') || t.includes('rainbow')) {
        return `"${childName} and the Rainbow Trail" or "${childName}'s Gentle Unicorn"`;
    }
    if (t.includes('train') || t.includes('vehicle')) {
        return `"${childName} and the Whispering Train" or "${childName}'s Midnight Express"`;
    }
    if (t.includes('circus') || t.includes('carnival')) {
        return `"${childName} and the Carousel Star" or "${childName}'s Grand Festival"`;
    }
    return `"${childName}'s Wondrous Journey" or "${childName} and the Golden Key"`;
}

// ====================================================================
// FLOW B: STEP 1 - CREATE FREE TEASER PREVIEW (WITH LANGUAGE & GENDER)
// ====================================================================
app.post('/api/create-preview', rateLimiter, async (req, res) => {
    const t0 = Date.now();
    try {
        const { childName, gender, age, theme, language, photoData, dedication, email, offer, attributes: clientAttributes } = req.body;
        if (!childName) return res.status(400).json({ success: false, error: 'Child name is required' });

        const lang = String(language || 'English').trim();

        // Step 0: Extract or merge visual & cultural attributes from reference photo
        const visualAttributes = await extractPhotoVisualAttributes(photoData, clientAttributes);
        const { genderClean, childAge, pronoun, subjectPronoun, charAnchor } = getCharacterDetails(childName, gender, age, theme, visualAttributes);

        const base = String(theme || 'Story').split(' (')[0];
        const pal = themeKit(base);
        assertZones();

        console.log(`✨ Preview | ${childName} (${genderClean}, ${childAge}) | ${base} | Lang=${lang}${visualAttributes.hasHeadwear ? ` | Headwear=${visualAttributes.headwearDescription}` : ''}${visualAttributes.hasGlasses ? ` | Glasses=yes` : ''}`);

        // Step 1: LLM unique title & opening rhyme (streamlined for fast preview load)
        const genderGuidance = (genderClean === 'little star')
            ? `The child is non-binary / gender-neutral (Little Star). Use gentle, gender-inclusive wording, using they/them pronouns or referring warmly to ${childName}.`
            : `The child protagonist is ${childName}, a ${childAge}-year-old ${genderClean} (${pronoun}/${subjectPronoun}).`;

        const themeExample = getThemeTitleExample(theme, childName);
        const systemPrompt = `You are an award-winning children's storybook author for TwinkleTale. Output ONLY a valid JSON object with keys:
"book_title": (a unique, poetic, charming 3-5 word storybook title in ${lang} specifically tailored to ${childName}'s bedtime adventure in ${theme}, e.g. ${themeExample}),
"opening_rhyme": (4 lines of lyrical, warm read-aloud rhyme welcoming ${childName} into their bedtime adventure in ${lang}).
${genderGuidance}
CRITICAL THEME CONSISTENCY RULE: The title MUST be deeply, authentically customized to the chosen theme: "${theme}". DO NOT use the word "Starlight" or space-related terms unless the theme is specifically Space & Stars. For Ocean themes, use ocean/marine imagery (Ocean, Waves, Coral, Dolphin, Tide, Deep Blue). For Forest themes, use woodland imagery (Forest, Woods, Acorn, Meadow). For Dinosaur themes, use prehistoric/giant imagery. Make each title unique, imaginative, and evocative.
LANGUAGE REQUIREMENT: All child-facing text ("book_title", "opening_rhyme") MUST be written beautifully in ${lang}. No markdown, no commentary.`;
        const userPrompt = `Create an enchanting ${theme} bedtime storybook title and opening rhyme for ${childName} in ${lang}.`;

        // Step 1: Launch LLM story outline in parallel with cover artwork generation
        const storyPromise = withRetry('preview story outline', () => callStoryLLM(systemPrompt, userPrompt, lang), 2, 3000)
            .then(rawStoryText => {
                let storyText = rawStoryText.replace(/```json/g, '').replace(/```/g, '').trim();
                return JSON.parse(storyText);
            })
            .catch(err => {
                console.warn('⚠️ Preview story outline fallback notice:', err.message);
                return {
                    book_title: `${childName}'s ${themeTitle(base)}`,
                    opening_rhyme: `Underneath the twinkling stars, where dreams begin to play,\nA special tale unfolds tonight, to softly guide your way.\nFor ${childName}, our little dreamer, so brave and kind and bright,\nA magical bedtime story starts before you sleep tonight.`
                };
            });

        const titlePromise = storyPromise.then(s => (s && s.book_title && s.book_title.trim()) || `${childName}'s ${themeTitle(base)}`);

        // Step 2: Generate Cover Artwork & Composite concurrently
        let coverBuffer = null;
        let coverIsComposited = true;
        let vigUrlRaw = null;

        if (IS_COVER_V2) {
            console.log(`🎨 [Cover Reimagination] Generating full-bleed spotlight cover for ${childName} (60-65% hero area)...`);
            const coverResult = await withRetry('reimagined cover generation', async () => {
                return await coverEngine.generateCover({
                    theme: base,
                    childName,
                    gender: genderClean,
                    age: childAge,
                    charAnchor,
                    bookTitle: titlePromise,
                    language: lang,
                    photoData,
                    attributes: visualAttributes
                });
            }, 2, 3000);

            coverBuffer = coverResult.coverBuffer;
            vigUrlRaw = coverResult.characterReferenceUrl || coverResult.rawArtUrl;
            var coverProvenance = coverResult.provenance || null;
            var coverDesignSpec = coverResult.designSpec || null;
            var coverCollision = coverResult.collisionResults || null;
            var coverDebugOverlay = coverResult.debugOverlayBuffer || null;
            var coverCharacterMaster = coverResult.characterMaster || null;
            var coverCharacterSheet = coverResult.characterSheet || null;
            var coverCharacterProfile = coverResult.characterProfile || null;
        } else {
            // Legacy v1 Medallion fallback
            const storyJsonV1 = await storyPromise;
            const bookTitleV1 = (storyJsonV1.book_title && storyJsonV1.book_title.trim()) || `${childName}'s ${themeTitle(base)}`;
            console.log("  → [V1 Fallback] Painting theme-relevant ornate border background...");
            const bgUrlRaw = await withRetry('cover background', async () => generateCoverBackground(base, pal));
            await sleep(PACING);

            console.log("  → [V1 Fallback] Painting child medallion hero...");
            vigUrlRaw = await withRetry('child medallion hero', async () => generateChildMedallion(charAnchor, base, pal, photoData));

            const [bgBuffer, vigBuffer] = await Promise.all([
                fetchImageBuffer(bgUrlRaw),
                fetchImageBuffer(vigUrlRaw)
            ]);

            console.log("  → [V1 Fallback] Compositing theme-framed cover with non-overlapping typography...");
            coverBuffer = await renderCoverCompositePng(bgBuffer, vigBuffer, childName, bookTitleV1, pal, lang);
            if (!coverBuffer) {
                console.warn("⚠️ Sharp cover composite notice, falling back to background buffer");
                coverBuffer = bgBuffer;
                coverIsComposited = false;
            }
        }

        const storyJson = await storyPromise;
        const bookTitle = (storyJson.book_title && storyJson.book_title.trim()) || `${childName}'s ${themeTitle(base)}`;
        const openingRhyme = storyJson.opening_rhyme || `Underneath the twinkling stars, where dreams begin to play,\nA special tale unfolds tonight, to softly guide your way.\nFor ${childName}, our little dreamer, so brave and kind and bright,\nA magical bedtime story starts before you sleep tonight.`;
        const scenesData = [];

        const previewId = `prev_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        // Disk persistence for bulletproof preview-to-final book locking
        try {
            fs.writeFileSync(path.join(booksFolder, `preview_${previewId}_cover.png`), coverBuffer);
            if (coverDebugOverlay) {
                fs.writeFileSync(path.join(booksFolder, `preview_${previewId}_debug_zones.png`), coverDebugOverlay);
            }
        } catch (fsErr) {
            console.warn('⚠️ Could not cache preview cover to disk:', fsErr.message);
        }

        let coverPublicUrl = `${req.protocol}://${req.get('host')}/books/preview_${previewId}_cover.png`;
        if (supabase) {
            const coverFileName = `preview_${previewId}_cover.png`;
            const cloudCover = await uploadToStorage(coverFileName, coverBuffer, 'image/png');
            if (cloudCover && cloudCover.finalUrl) {
                coverPublicUrl = cloudCover.publicUrl || cloudCover.finalUrl;
            }
        }

        saveSession(previewId, {
            previewId,
            timestamp: Date.now(),
            childName, gender: genderClean, age: childAge, theme, language: lang,
            photoData, dedication, email,
            attributes: visualAttributes,
            characterMaster: typeof coverCharacterMaster !== 'undefined' ? coverCharacterMaster : null,
            characterSheet: typeof coverCharacterSheet !== 'undefined' ? coverCharacterSheet : null,
            characterProfile: typeof coverCharacterProfile !== 'undefined' ? coverCharacterProfile : null,
            charAnchor, pronoun, subjectPronoun, pal,
            title: bookTitle, bookTitle,
            coverUrl: coverPublicUrl,
            referencePortraitUrl: (typeof coverCharacterMaster !== 'undefined' && coverCharacterMaster && coverCharacterMaster.masterUrl) ? coverCharacterMaster.masterUrl : vigUrlRaw, // PRD FR-1 & FR-3: Single locked reference portrait anchor
            coverProvenance: typeof coverProvenance !== 'undefined' ? coverProvenance : null,
            coverDesignSpec: typeof coverDesignSpec !== 'undefined' ? coverDesignSpec : null,
            coverCollision: typeof coverCollision !== 'undefined' ? coverCollision : null,
            coverIsComposited,
            // Buffers are saved to disk (preview_${previewId}_cover.png) to keep RAM usage under 15MB
            coverBuffer: null,
            bgUrl: coverPublicUrl, vigUrl: coverPublicUrl,
            scenesData, openingRhyme,
            coverImagePrompt: storyJson.cover_image_prompt,
            offer: offer || req.body.offer || null
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
            offer: offer || req.body.offer || null,
            attributes: visualAttributes,
            // Backwards compatibility fields
            vignetteDataUrl: coverPublicUrl,
            coverBgDataUrl: coverPublicUrl,
            vignetteUrl: coverPublicUrl,
            coverBgUrl: coverPublicUrl
        });
    } catch (err) {
        console.error("❌ Preview error:", err.message);
        let userErrorMessage = err.message;
        if (/sensitive|E005|flagged|safety/i.test(err.message)) {
            userErrorMessage = "Automated image safety filters were triggered for this photo. Please try uploading a different clear photo of your child's face (such as a portrait or school photo), or choose Skip Preview to order directly!";
        }
        res.status(500).json({ success: false, error: userErrorMessage });
    }
});

// ====================================================================
// FLOW B: STEP 2 - CREATE RAZORPAY ORDER
// ====================================================================
app.post('/api/create-order', rateLimiter, async (req, res) => {
    try {
        const { previewId, bookLength, email, offer } = req.body;
        let session = previewId ? getSession(previewId) : null;
        const marketKey = resolveMarketKey(req.body, session || {});
        const market = MARKET_CONFIG[marketKey] || MARKET_CONFIG.IN;
        const currency = market.currency;

        const isLong = String(bookLength || '').toLowerCase().includes('long') || String(bookLength || '').includes('24') || String(bookLength || '').includes('22') || String(bookLength || '').includes('28') || String(bookLength || '').includes('grand');
        // US market launches with 50% off ($5.99 / $11.99). IN market uses special99 promo (₹99 / ₹199) or standard (₹199 / ₹299)
        const isOffer = marketKey === 'US' ? (offer !== 'standard' && req.body.offer !== 'standard') : ((offer === 'special99') || (req.body.offer === 'special99') || (session && session.offer === 'special99'));
        const amountSubunits = computeEditionSubunits(marketKey, isLong, isOffer);

        if (session) {
            // PRD FR-5: Refresh timestamp so session TTL does not expire during checkout
            session.timestamp = Date.now();
            if (offer) session.offer = offer;
            session.market = marketKey;
            session.currency = currency;
            session.expectedSubunits = amountSubunits;
            saveSession(previewId, session);
        }
        let effectivePreviewId = previewId;

        // Direct Checkout Support (instant payment without prior preview generation)
        if (req.body.isDirectCheckout || (!session && req.body.childName)) {
            const { childName, gender, age, theme, language, photoData, dedication, email: reqEmail, attributes: clientAttributes } = req.body;
            effectivePreviewId = `direct_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            const visualAttributes = await extractPhotoVisualAttributes(photoData, clientAttributes);
            const { genderClean, childAge, pronoun, subjectPronoun, charAnchor } = getCharacterDetails(childName, gender, age, theme, visualAttributes);
            const lang = language || 'English';
            const base = String(theme || 'Magical Forest').split(' (')[0];
            const pal = themeKit(base);
            const bookTitle = `${childName}'s ${themeTitle(base)}`;

            session = {
                previewId: effectivePreviewId,
                timestamp: Date.now(),
                isDirectCheckout: true,
                childName: childName || 'Child',
                gender: genderClean,
                age: childAge,
                theme: base,
                language: lang,
                photoData: photoData || null,
                attributes: visualAttributes,
                dedication: dedication || '',
                email: email || reqEmail || '',
                offer: isOffer ? (marketKey === 'US' ? 'us_launch_50off' : 'special99') : null,
                market: marketKey,
                currency: currency,
                expectedSubunits: amountSubunits,
                charAnchor, pronoun, subjectPronoun, pal,
                title: bookTitle, bookTitle,
                coverBuffer: null,
                scenesData: [],
                bookLength: isLong ? 'long' : 'short'
            };
            saveSession(effectivePreviewId, session);
            console.log(`⚡ Direct checkout session created for ${session.childName} (id: ${effectivePreviewId}, market: ${marketKey}, currency: ${currency}, subunits: ${amountSubunits})`);
        } else if (!session && !String(previewId || '').startsWith('test_')) {
            return res.status(404).json({ success: false, error: 'Preview session expired. Please preview your book again.' });
        }

        if (razorpay) {
            const order = await razorpay.orders.create({
                amount: amountSubunits,
                currency: currency,
                payment_capture: 1, // Auto-capture payment immediately upon authorization to prevent gateway timeouts
                receipt: (effectivePreviewId || `rcpt_${Date.now()}`).slice(0, 30),
                notes: {
                    previewId: effectivePreviewId || '',
                    bookLength: isLong ? '22 pages' : '12 pages',
                    childName: session ? session.childName : 'Child',
                    email: email || (session ? session.email : ''),
                    market: marketKey,
                    currency: currency,
                    offer: isOffer ? (marketKey === 'US' ? 'us_launch_50off' : 'special99') : 'standard'
                }
            });
            return res.json({
                success: true,
                orderId: order.id,
                previewId: effectivePreviewId,
                amount: amountSubunits,
                currency: currency,
                market: marketKey,
                keyId: process.env.RAZORPAY_KEY_ID
            });
        } else {
            const simOrderId = `order_sim_${Date.now()}`;
            return res.json({
                success: true,
                orderId: simOrderId,
                previewId: effectivePreviewId,
                amount: amountSubunits,
                currency: currency,
                market: marketKey,
                keyId: 'rzp_test_simulated_key',
                isTestMode: true
            });
        }
    } catch (err) {
        console.error("❌ Order creation error:", err.message);
        let userErrorMessage = err.message;
        if (/sensitive|E005|flagged|safety/i.test(err.message)) {
            userErrorMessage = "Automated image safety filters were triggered for this photo. Please try uploading a different clear photo of your child's face (such as a portrait or school photo), or choose Skip Preview to order directly!";
        }
        res.status(500).json({ success: false, error: userErrorMessage });
    }
});

// ====================================================================
// ROBUST ASYNCHRONOUS BOOK GENERATION QUEUE (CONCURRENCY=1, 3 RETRIES, DLQ)
// ====================================================================
class BookGenerationQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.concurrency = 1;
        this.maxAttempts = 3;
        this.currentItem = null;
    }

    isSessionInUse(previewId) {
        if (!previewId) return false;
        if (this.currentItem && ((this.currentItem.session && this.currentItem.session.previewId === previewId) || this.currentItem.previewId === previewId)) {
            return true;
        }
        return this.queue.some(item => (item.session && item.session.previewId === previewId) || item.previewId === previewId);
    }

    enqueue(item) {
        if (!item || !item.jobId) return;
        item.attempts = item.attempts || 0;
        item.enqueuedAt = item.enqueuedAt || Date.now();

        // Write disk queue file for crash/restart recovery
        try {
            const qFile = path.join(booksFolder, `queue_${item.jobId}.json`);
            const safeItem = {
                jobId: item.jobId,
                attempts: item.attempts,
                bookLength: item.bookLength,
                parentEmail: item.parentEmail,
                protocol: item.protocol,
                host: item.host,
                previewId: (item.session && item.session.previewId) || item.previewId,
                enqueuedAt: item.enqueuedAt
            };
            fs.writeFileSync(qFile, JSON.stringify(safeItem, null, 2));
        } catch (err) {
            console.warn(`⚠️ [QUEUE] Could not persist queue_${item.jobId}.json:`, err.message);
        }

        this.queue.push(item);
        console.log(`📥 [QUEUE] Job ${item.jobId} enqueued. Queue length: ${this.queue.length}`);

        // Trigger worker asynchronously
        setImmediate(() => this.processNext());
    }

    async processNext() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        const item = this.queue.shift();
        this.currentItem = item;
        const { jobId, bookLength, parentEmail, protocol, host } = item;
        let session = item.session;

        // Restore session from disk if recovering from restart
        if (!session && item.previewId) {
            session = getSession(item.previewId);
        }

        // Resilient session fallback: reconstruct if session was lost across container restarts
        if (!session) {
            const jobData = getJob(jobId) || {};
            const fallbackChildName = jobData.childName || 'Child';
            const fallbackTheme = jobData.theme || 'Story';
            console.warn(`⚠️ [QUEUE] Session missing for Job ${jobId} (preview: ${item.previewId || 'none'}). Reconstructing from job records...`);
            session = {
                previewId: item.previewId || `recov_${Date.now()}`,
                childName: fallbackChildName,
                gender: 'hero',
                age: 5,
                theme: fallbackTheme,
                language: jobData.language || 'English',
                email: parentEmail || jobData.email || '',
                charAnchor: 'adorable child hero in luminous painterly picture book art',
                pal: themeKit(fallbackTheme),
                title: `${fallbackChildName}'s Adventure`,
                bookTitle: `${fallbackChildName}'s Adventure`,
                scenesData: []
            };
        }

        console.log(`⚡ [QUEUE] Starting Job ${jobId} (Attempt ${item.attempts + 1}/${this.maxAttempts}). Remaining in queue: ${this.queue.length}`);

        try {
            await assembleFullBookAsync(jobId, session, bookLength, parentEmail, protocol, host);

            // Successfully fulfilled: remove queue persistence file
            try {
                const qFile = path.join(booksFolder, `queue_${jobId}.json`);
                if (fs.existsSync(qFile)) fs.unlinkSync(qFile);
            } catch (_) {}

            console.log(`🎉 [QUEUE] Job ${jobId} fulfilled successfully!`);
            this.currentItem = null;
            this.processing = false;
            this.processNext();
        } catch (err) {
            item.attempts = (item.attempts || 0) + 1;
            console.error(`❌ [QUEUE] Job ${jobId} failed on attempt ${item.attempts}/${this.maxAttempts}:`, err.message);

            if (item.attempts < this.maxAttempts) {
                // Exponential backoff: Attempt 1 fail -> 15s delay; Attempt 2 fail -> 45s delay
                const delayMs = item.attempts === 1 ? 15000 : 45000;
                console.log(`⏳ [QUEUE RETRY] Backing off for ${delayMs / 1000}s before retrying Job ${jobId} (Attempt ${item.attempts + 1}/${this.maxAttempts})...`);

                // Inform status checkers that retry is in progress
                const j = getJob(jobId) || { id: jobId, timestamp: Date.now() };
                j.progress = 25;
                j.step = `Re-calibrating storybook rendering (attempt ${item.attempts + 1}/${this.maxAttempts})...`;
                j.retryCount = item.attempts;
                saveJob(jobId, j);

                setTimeout(() => {
                    // Prepend back to front of queue to prioritize this paying customer
                    this.queue.unshift(item);
                    this.currentItem = null;
                    this.processing = false;
                    this.processNext();
                }, delayMs);
            } else {
                // All 3 attempts exhausted -> Move to Dead Letter Queue (DLQ)
                await this.handleDeadLetter(item, err);
                this.currentItem = null;
                this.processing = false;
                this.processNext();
            }
        }
    }

    async handleDeadLetter(item, err) {
        const { jobId, session, parentEmail } = item;
        console.error(`🚨 [DLQ] Job ${jobId} EXHAUSTED all ${this.maxAttempts} attempts! Moving to Dead Letter Queue.`);

        // 1. Write DLQ artifact on disk
        const dlqData = {
            jobId,
            failedAt: new Date().toISOString(),
            timestamp: Date.now(),
            attempts: item.attempts,
            error: err.message,
            stack: err.stack,
            childName: (session && session.childName) || 'Unknown',
            theme: (session && session.theme) || 'Unknown',
            language: (session && session.language) || 'Unknown',
            parentEmail: parentEmail || (session && session.email) || 'Unknown',
            bookLength: item.bookLength
        };

        try {
            const dlqFile = path.join(booksFolder, `dlq_${jobId}.json`);
            fs.writeFileSync(dlqFile, JSON.stringify(dlqData, null, 2));
            console.log(`📁 [DLQ] Failure report written to ${dlqFile}`);

            // Remove pending queue file
            const qFile = path.join(booksFolder, `queue_${jobId}.json`);
            if (fs.existsSync(qFile)) fs.unlinkSync(qFile);
        } catch (dlqErr) {
            console.warn(`⚠️ [DLQ] Could not write DLQ file:`, dlqErr.message);
        }

        // 2. Mark job status as failed
        const job = getJob(jobId) || { id: jobId, timestamp: Date.now() };
        job.status = 'failed';
        job.error = err.message;
        job.step = 'Generation encountered an error after multiple attempts';
        saveJob(jobId, job);

        // 3. Automated Razorpay Refund on DLQ failure
        if (razorpay && job.paymentId && process.env.AUTO_REFUND_ON_FAILURE !== 'false') {
            try {
                const refundCurrency = job.currency || (job.amountPaise ? 'INR' : 'USD');
                const refundSymbol = refundCurrency === 'USD' ? '$' : '₹';
                const refundSubunits = job.amountSubunits || job.amountPaise || (refundCurrency === 'USD' ? 599 : 19900);
                const refundFormatted = (refundSubunits / 100).toFixed(2);

                console.log(`💸 [DLQ] Initiating fail-safe refund for Job ${jobId} (Payment: ${job.paymentId}, Currency: ${refundCurrency}, Amount: ${refundSubunits})...`);
                const refund = await razorpay.payments.refund(job.paymentId, {
                    amount: refundSubunits,
                    notes: {
                        reason: "Automated DLQ fulfillment failure after 3 attempts",
                        jobId: jobId,
                        childName: (session && session.childName) || 'Child',
                        currency: refundCurrency,
                        error: (err.message || '').slice(0, 100)
                    }
                });
                console.log(`✅ [DLQ] Automated Refund initiated: ${refund.id}`);
                job.refundId = refund.id;
                job.refundStatus = 'initiated';
                saveJob(jobId, job);

                // Customer refund email
                if (mailer && parentEmail) {
                    await mailer.sendMail({
                        to: parentEmail,
                        subject: `TwinkleTale — Full Refund Initiated for ${(session && session.childName) || 'Your Child'}'s Storybook`,
                        html: `<div style="font-family:Georgia,serif;padding:32px;background:#FAF7F2;border-radius:12px;max-width:600px;margin:0 auto;border:1px solid #EAE4D9">
                            <h2 style="color:#842029;margin-top:0">We apologize for the inconvenience</h2>
                            <p style="font-size:16px;color:#333;line-height:1.6">Dear Parent,</p>
                            <p style="font-size:16px;color:#333;line-height:1.6">While creating the high-resolution illustrations for <strong>${(session && session.childName) || 'your child'}'s storybook</strong>, our illustration studio encountered an unexpected technical delay.</p>
                            <p style="font-size:16px;color:#333;line-height:1.6">To ensure your complete peace of mind, we have <strong>automatically initiated a 100% full refund</strong> of ${refundSymbol}${refundFormatted} back to your original payment method.</p>
                            <div style="background:#FFF;padding:16px;border-radius:8px;border:1px solid #DDD;margin:20px 0">
                                <p style="margin:4px 0;font-size:14px;color:#555"><strong>Refund ID:</strong> ${refund.id}</p>
                                <p style="margin:4px 0;font-size:14px;color:#555"><strong>Payment ID:</strong> ${job.paymentId}</p>
                                <p style="margin:4px 0;font-size:14px;color:#555"><strong>Amount Refunded:</strong> ${refundSymbol}${refundFormatted}</p>
                                <p style="margin:4px 0;font-size:14px;color:#555"><strong>Arrival:</strong> 3-5 business days directly to your original bank/card</p>
                            </div>
                            <p style="font-size:14px;color:#555">If you have any questions, our support team is right here to help at <a href="mailto:${process.env.SENDER_EMAIL || 'support@twinkletaleai.com'}">${process.env.SENDER_EMAIL || 'support@twinkletaleai.com'}</a>.</p>
                            <hr style="border:none;border-top:1px solid #DDD;margin:24px 0">
                            <p style="font-size:12px;color:#999;text-align:center">TwinkleTale Studios • Customer Protection Guarantee</p>
                        </div>`
                    });
                }
            } catch (refundErr) {
                console.error(`⚠️ [DLQ] Automated Razorpay refund error:`, refundErr.message);
            }
        } else if (mailer && parentEmail) {
            try {
                await mailer.sendMail({
                    to: parentEmail,
                    subject: `TwinkleTale — Update on ${(session && session.childName) || 'Your Child'}'s Storybook Order`,
                    html: `<div style="font-family:Georgia,serif;padding:32px;background:#FAF7F2;border-radius:12px;max-width:600px;margin:0 auto;border:1px solid #EAE4D9">
                        <h2 style="color:#161B33;margin-top:0">Order Update for ${(session && session.childName) || 'Your Child'}'s Storybook</h2>
                        <p style="font-size:16px;color:#333;line-height:1.6">Dear Parent,</p>
                        <p style="font-size:16px;color:#333;line-height:1.6">Our studio experienced a brief delay while rendering ${(session && session.childName) || 'your child'}'s personalized storybook. Our engineers have been alerted and are resolving this for you.</p>
                        <p style="font-size:16px;color:#333;line-height:1.6">Your storybook will either be delivered to this email shortly, or a full refund will be processed. You can contact us anytime at <a href="mailto:${process.env.SENDER_EMAIL || 'support@twinkletaleai.com'}">${process.env.SENDER_EMAIL || 'support@twinkletaleai.com'}</a>.</p>
                    </div>`
                });
            } catch (_) {}
        }

        // 4. Critical Admin Alert Email to process.env.ADMIN_EMAIL || process.env.SENDER_EMAIL
        const adminRecipient = process.env.ADMIN_EMAIL || process.env.SENDER_EMAIL;
        if (mailer && adminRecipient) {
            try {
                const alertCurrency = job.currency || (job.amountPaise ? 'INR' : 'USD');
                const alertSymbol = alertCurrency === 'USD' ? '$' : '₹';
                const alertSubunits = job.amountSubunits || job.amountPaise || 0;
                const alertFormatted = (alertSubunits / 100).toFixed(2);
                await mailer.sendMail({
                    to: adminRecipient,
                    subject: `🚨 [CRITICAL DLQ ALERT] Order Fulfillment Failed — Job ${jobId} (3 Retries Exhausted)`,
                    html: `<div style="font-family:sans-serif;padding:24px;border:2px solid #dc3545;border-radius:8px;background:#fff8f8;max-width:640px">
                        <h2 style="color:#dc3545;margin-top:0">🚨 Dead Letter Queue Alert — All 3 Retries Exhausted</h2>
                        <p><strong>Job ID:</strong> ${jobId}</p>
                        <p><strong>Customer Email:</strong> ${parentEmail || 'N/A'}</p>
                        <p><strong>Payment ID:</strong> ${job.paymentId || 'N/A'}</p>
                        <p><strong>Order ID:</strong> ${job.orderId || 'N/A'}</p>
                        <p><strong>Amount:</strong> ${alertSymbol}${alertFormatted} (${alertCurrency})</p>
                        <p><strong>Child:</strong> ${(session && session.childName) || 'N/A'} (${(session && session.theme) || 'N/A'}, ${(session && session.language) || 'N/A'})</p>
                        <p><strong>Refund Status:</strong> ${job.refundStatus || 'none'} (${job.refundId || 'none'})</p>
                        <hr style="border:none;border-top:1px solid #e0c8c8;margin:16px 0">
                        <p><strong>Failure Cause:</strong> <code style="color:#c7254e;background:#f9f2f4;padding:3px 6px;border-radius:4px">${err.message}</code></p>
                        <pre style="background:#2d3748;color:#f7fafc;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;white-space:pre-wrap">${err.stack || 'No stack trace available'}</pre>
                        <p style="font-size:12px;color:#718096">Artifact saved locally at: <code>books/dlq_${jobId}.json</code></p>
                    </div>`
                });
                console.log(`📧 [DLQ] Immediate Admin Alert email dispatched to ${adminRecipient}`);
            } catch (mailErr) {
                console.error(`⚠️ [DLQ] Failed to send admin alert email:`, mailErr.message);
            }
        }
    }

    recoverPendingJobs() {
        try {
            if (!fs.existsSync(booksFolder)) return;
            const files = fs.readdirSync(booksFolder);
            const queueFiles = files.filter(f => f.startsWith('queue_') && f.endsWith('.json'));
            if (queueFiles.length === 0) return;

            console.log(`🔄 [QUEUE RECOVERY] Found ${queueFiles.length} pending job(s) from prior session. Recovering...`);
            for (const file of queueFiles) {
                try {
                    const filePath = path.join(booksFolder, file);
                    const raw = fs.readFileSync(filePath, 'utf8');
                    const item = JSON.parse(raw);
                    const job = getJob(item.jobId);
                    if (job && job.status === 'completed') {
                        try { fs.unlinkSync(filePath); } catch (_) {}
                        continue;
                    }
                    let session = getSession(item.previewId);
                    if (!session) {
                        const job = getJob(item.jobId) || {};
                        const fallbackChildName = job.childName || 'Child';
                        const fallbackTheme = job.theme || 'Story';
                        console.warn(`⚠️ [QUEUE RECOVERY] Session data missing on disk for queued job ${item.jobId} (previewId: ${item.previewId}). Reconstructing session...`);
                        session = {
                            previewId: item.previewId || `recov_${Date.now()}`,
                            childName: fallbackChildName,
                            gender: 'hero',
                            age: 5,
                            theme: fallbackTheme,
                            language: job.language || 'English',
                            email: item.parentEmail || job.email || '',
                            charAnchor: 'adorable child hero in luminous painterly picture book art',
                            pal: themeKit(fallbackTheme),
                            title: `${fallbackChildName}'s Adventure`,
                            bookTitle: `${fallbackChildName}'s Adventure`,
                            scenesData: []
                        };
                    }
                    item.session = session;
                    console.log(`📥 [QUEUE RECOVERY] Auto-recovering interrupted job ${item.jobId} for ${(session && session.childName) || 'child'} (${item.parentEmail || (session && session.email)})`);
                    this.enqueue(item);
                } catch (err) {
                    console.warn(`⚠️ [QUEUE RECOVERY] Error processing ${file}:`, err.message);
                }
            }
        } catch (e) {
            console.warn(`⚠️ [QUEUE RECOVERY] Error scanning for pending jobs:`, e.message);
        }
    }
}

const bookQueue = new BookGenerationQueue();
bookQueue.recoverPendingJobs();

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

        let session = getSession(previewId);

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

        const marketKey = resolveMarketKey(req.body, session || {});
        const market = MARKET_CONFIG[marketKey] || MARKET_CONFIG.IN;
        const expectedCurrency = market.currency;

        const isLong = String(bookLength || session?.bookLength || '').toLowerCase().includes('long') || String(bookLength || '').includes('24') || String(bookLength || '').includes('22') || String(bookLength || '').includes('28') || String(bookLength || '').includes('grand');
        const isOffer = marketKey === 'US' ? (session?.offer !== 'standard' && req.body.offer !== 'standard') : ((session && session.offer === 'special99') || req.body.offer === 'special99');
        const minExpectedSubunits = computeEditionSubunits(marketKey, isLong, isOffer);

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
                if (payment.currency && payment.currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
                    return res.status(400).json({ success: false, error: `Payment currency mismatch. Expected ${expectedCurrency}, received ${payment.currency}.` });
                }
                if (payment.amount < minExpectedSubunits) {
                    return res.status(400).json({ success: false, error: 'Paid amount is less than the required book edition price.' });
                }

                // If payment was authorized but not yet captured, capture it immediately to guarantee settlement
                if (payment.status === 'authorized') {
                    try {
                        console.log(`💳 [RAZORPAY] Capturing authorized payment ${razorpay_payment_id} (${expectedCurrency} ${payment.amount})...`);
                        await razorpay.payments.capture(razorpay_payment_id, payment.amount, payment.currency || expectedCurrency);
                        console.log(`✅ [RAZORPAY] Payment ${razorpay_payment_id} captured successfully!`);
                    } catch (capErr) {
                        console.warn(`⚠️ [RAZORPAY] Payment capture notice (may already be auto-captured):`, capErr.message);
                    }
                }
            } catch (fetchErr) {
                console.error('❌ Razorpay server audit error:', fetchErr.message);
                return res.status(400).json({ success: false, error: 'Failed to verify transaction status directly with Razorpay.' });
            }

            // Mark payment as fulfilled to prevent re-submissions
            fulfilledPayments.set(razorpay_payment_id, Date.now());
            console.log(`💳 Cryptographically Verified & Settled: ${razorpay_payment_id} for order ${razorpay_order_id} (${expectedCurrency} ${minExpectedSubunits})`);
        } else {
            // In Production, reject unconfigured gateways immediately
            if (process.env.NODE_ENV === 'production') {
                return res.status(503).json({ success: false, error: 'Razorpay payment gateway is not configured for production transactions.' });
            }
            console.log(`💳 Test Payment simulated in dev mode: ${razorpay_payment_id || 'test_payment'} (${expectedCurrency} ${minExpectedSubunits})`);
        }

        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        saveJob(jobId, {
            id: jobId,
            timestamp: Date.now(),
            status: 'queued',
            progress: 15,
            step: 'Painting decorative story borders...',
            pdfUrl: null,
            emailed: false,
            error: null,
            previewId: session.previewId,
            orderId: razorpay_order_id || null,
            paymentId: razorpay_payment_id || null,
            market: marketKey,
            currency: expectedCurrency,
            amountSubunits: minExpectedSubunits,
            amountPaise: expectedCurrency === 'INR' ? minExpectedSubunits : undefined,
            email: email || session.email || null,
            bookLength
        });

        // Decouple full book generation into asynchronous background queue
        bookQueue.enqueue({
            jobId,
            session,
            bookLength,
            parentEmail: email || session.email,
            protocol: req.protocol,
            host: req.get('host'),
            market: marketKey,
            currency: expectedCurrency
        });

        res.json({ success: true, jobId, queued: true });
    } catch (err) {
        console.error("❌ Verify error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ====================================================================
// RECOVERY: MANUAL / AUTOMATED FULFILLMENT OF UNRECEIVED ORDERS
// ====================================================================
async function handleOrderFulfillment(req, res) {
    try {
        const paymentId = req.body.paymentId || req.query.paymentId;
        const orderId = req.body.orderId || req.query.orderId;
        const previewId = req.body.previewId || req.query.previewId;
        let targetEmail = req.body.email || req.query.email;

        console.log(`🔧 [ORDER FULFILLMENT] Request received: paymentId=${paymentId || 'none'}, orderId=${orderId || 'none'}, previewId=${previewId || 'none'}, email=${targetEmail || 'none'}`);

        let effectivePreviewId = previewId;
        let bookLength = '12 pages';
        let childName = 'Child';
        let paymentRecord = null;

        // 1. If Razorpay paymentId provided, fetch payment details and notes
        if (razorpay && paymentId) {
            try {
                paymentRecord = await razorpay.payments.fetch(paymentId);
                if (paymentRecord) {
                    if (paymentRecord.notes) {
                        if (paymentRecord.notes.previewId) effectivePreviewId = paymentRecord.notes.previewId;
                        if (paymentRecord.notes.email && !targetEmail) targetEmail = paymentRecord.notes.email;
                        if (paymentRecord.notes.bookLength) bookLength = paymentRecord.notes.bookLength;
                        if (paymentRecord.notes.childName) childName = paymentRecord.notes.childName;
                    }
                    if (paymentRecord.email && !targetEmail) targetEmail = paymentRecord.email;
                }
            } catch (err) {
                console.warn(`⚠️ [ORDER FULFILLMENT] Razorpay payment fetch notice:`, err.message);
            }
        } else if (razorpay && orderId) {
            try {
                const payments = await razorpay.orders.fetchPayments(orderId);
                if (payments && payments.items && payments.items.length > 0) {
                    paymentRecord = payments.items.find(p => p.status === 'captured') || payments.items[0];
                    if (paymentRecord) {
                        if (paymentRecord.notes) {
                            if (paymentRecord.notes.previewId) effectivePreviewId = paymentRecord.notes.previewId;
                            if (paymentRecord.notes.email && !targetEmail) targetEmail = paymentRecord.notes.email;
                            if (paymentRecord.notes.bookLength) bookLength = paymentRecord.notes.bookLength;
                            if (paymentRecord.notes.childName) childName = paymentRecord.notes.childName;
                        }
                        if (paymentRecord.email && !targetEmail) targetEmail = paymentRecord.email;
                    }
                }
            } catch (err) {
                console.warn(`⚠️ [ORDER FULFILLMENT] Razorpay order fetch notice:`, err.message);
            }
        }

        // 2. Load or reconstruct session
        let session = effectivePreviewId ? getSession(effectivePreviewId) : null;
        if (!session && effectivePreviewId) {
            const diskCoverPath = path.join(booksFolder, `preview_${effectivePreviewId}_cover.png`);
            if (fs.existsSync(diskCoverPath)) {
                session = {
                    previewId: effectivePreviewId,
                    childName,
                    gender: 'hero',
                    age: 5,
                    theme: 'Magical Forest',
                    language: 'English',
                    email: targetEmail || '',
                    coverBuffer: fs.readFileSync(diskCoverPath),
                    charAnchor: 'adorable child hero in luminous painterly picture book art',
                    pal: themeKit('Magical Forest'),
                    title: `${childName}'s Adventure`,
                    bookTitle: `${childName}'s Adventure`,
                    scenesData: []
                };
            }
        }

        if (!session) {
            const finalChildName = req.body.childName || req.query.childName || (paymentRecord && paymentRecord.notes && paymentRecord.notes.childName) || childName || 'Child';
            const finalTheme = req.body.theme || req.query.theme || (paymentRecord && paymentRecord.notes && paymentRecord.notes.theme) || 'Magical Forest';
            const finalLanguage = req.body.language || req.query.language || (paymentRecord && paymentRecord.notes && paymentRecord.notes.language) || 'English';
            console.log(`🔧 [ORDER FULFILLMENT] Reconstructing session from parameters/notes for ${finalChildName}...`);
            session = {
                previewId: effectivePreviewId || `recov_${Date.now()}`,
                childName: finalChildName,
                gender: req.body.gender || req.query.gender || 'hero',
                age: req.body.age || req.query.age || 5,
                theme: finalTheme,
                language: finalLanguage,
                email: targetEmail || '',
                charAnchor: 'adorable child hero in luminous painterly picture book art',
                pal: themeKit(finalTheme),
                title: `${finalChildName}'s Adventure`,
                bookTitle: `${finalChildName}'s Adventure`,
                scenesData: []
            };
        }

        // 3. Create fresh Job and enqueue
        const jobId = `job_fulfill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const emailToDeliver = targetEmail || session.email;
        saveJob(jobId, {
            id: jobId,
            timestamp: Date.now(),
            status: 'queued',
            progress: 15,
            step: 'Assembling and rendering high-resolution storybook...',
            pdfUrl: null,
            emailed: false,
            error: null,
            previewId: session.previewId,
            orderId: orderId || null,
            paymentId: paymentId || (paymentRecord && paymentRecord.id) || null,
            email: emailToDeliver,
            bookLength
        });

        bookQueue.enqueue({
            jobId,
            session,
            bookLength,
            parentEmail: emailToDeliver,
            protocol: req.protocol,
            host: req.get('host')
        });

        return res.json({
            success: true,
            message: `Fulfillment job started! Your storybook is generating and will be sent directly to ${emailToDeliver}.`,
            jobId,
            statusUrl: `/api/download/${jobId}`,
            email: emailToDeliver
        });
    } catch (err) {
        console.error('❌ [ORDER FULFILLMENT] Error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}

app.post('/api/admin/fulfill-order', handleOrderFulfillment);
app.get('/api/admin/fulfill-order', handleOrderFulfillment);
app.post('/api/fulfill-order', handleOrderFulfillment);
app.get('/api/fulfill-order', handleOrderFulfillment);

// ====================================================================
// JOB STATUS POLLING
// ====================================================================
app.get('/api/job-status/:jobId', async (req, res) => {
    const job = await getJobAsync(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({
        success: true,
        status: job.status,
        progress: job.progress,
        step: job.step,
        pdfUrl: job.pdfUrl,
        emailed: job.emailed,
        error: job.error,
        refundId: job.refundId || null,
        refundStatus: job.refundStatus || null
    });
});

// ====================================================================
// PERMANENT STORYBOOK DOWNLOAD ENDPOINTS (NEVER EXPIRES)
// ====================================================================
async function handleDownloadStorybook(req, res) {
    const { jobId } = req.params;
    if (!jobId) {
        return res.status(400).send(renderDownloadHtmlMessage('Invalid Link', 'No storybook identifier was provided in this link.'));
    }

    let job = await getJobAsync(jobId);

    // If job not found in memory/disk/cloud, check if jobId happens to match a local or cloud file
    if (!job) {
        const potentialFile = path.join(booksFolder, jobId.endsWith('.pdf') ? jobId : `${jobId}.pdf`);
        if (fs.existsSync(potentialFile)) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${path.basename(potentialFile)}"`);
            return res.sendFile(potentialFile);
        }

        // Cloud storage search fallback: check if Supabase has a matching PDF file directly
        if (supabase) {
            try {
                const cleanTarget = jobId.endsWith('.pdf') ? jobId : `${jobId}.pdf`;
                const signedRes = await supabase.storage.from('storybooks').createSignedUrl(cleanTarget, 2592000);
                if (signedRes?.data?.signedUrl) {
                    console.log(`☁️ [SUPABASE] Found storybook PDF directly in cloud storage: ${cleanTarget}`);
                    return res.redirect(signedRes.data.signedUrl);
                }

                // Check bucket files matching jobId
                const { data: files } = await supabase.storage.from('storybooks').list('', { limit: 100 });
                const matchedFile = files?.find(f => f.name.includes(jobId) && f.name.endsWith('.pdf'));
                if (matchedFile) {
                    const matchSigned = await supabase.storage.from('storybooks').createSignedUrl(matchedFile.name, 2592000);
                    if (matchSigned?.data?.signedUrl) {
                        console.log(`☁️ [SUPABASE] Found matched storybook PDF in bucket: ${matchedFile.name}`);
                        return res.redirect(matchSigned.data.signedUrl);
                    }
                }
            } catch (supErr) {
                console.warn(`⚠️ [SUPABASE] Storage direct lookup notice for ${jobId}:`, supErr.message);
            }
        }

        // Special recovery verification for recent test order (Leo)
        if (jobId.includes('1789617803748_6k52r') || jobId.includes('677c2f01a9ecea3c04152861cc18ea88')) {
            return res.status(200).send(renderDownloadHtmlMessage(
                '✨ Order Verified & Re-assembly Ready',
                `We verified your test payment for <strong>Leo's Storybook (Grand Treasury Edition)</strong> [Payment ID: pay_Tcxtx2P6isOsAY / Order ID: order_TcxtihpGKCa2uL].
                <br><br>
                Because an ephemeral container restarted before permanent cloud storage was linked, the temporary local file was cleared. Our permanent Supabase cloud storage is now fully online.
                <br><br>
                Please email <a href="mailto:support@twinkletaleai.com?subject=Leo%20Storybook%20Delivery%20job_1789617803748_6k52r" style="color:#1B4938;font-weight:bold;">support@twinkletaleai.com</a> with your order note or generate a new test book — all future books now permanently persist in cloud storage!`
            ));
        }

        return res.status(404).send(renderDownloadHtmlMessage(
            'Storybook Not Found',
            'We could not locate this storybook. It may have expired or the order reference is incorrect. If you need assistance, please contact us at <a href="mailto:support@twinkletaleai.com" style="color:#1B4938;font-weight:bold;">support@twinkletaleai.com</a> with your order details.'
        ));
    }

    // If the job is still queued or in progress
    if (job.status === 'queued' || job.status === 'generating') {
        return res.send(renderDownloadHtmlMessage(
            '✨ Crafting Your Magical Storybook',
            `We are currently illustrating and assembling your personalized storybook!
            <br><br>
            <strong>Status:</strong> ${job.step || 'Painting storybook illustrations...'} (${job.progress || 20}%)
            <br><br>
            Please refresh this page in 1–2 minutes, or check your inbox at <strong>${job.email || 'your email'}</strong> once delivery completes.`,
            true // autoRefresh
        ));
    }

    // If the job failed
    if (job.status === 'failed') {
        return res.status(500).send(renderDownloadHtmlMessage(
            'Fulfillment Assistance Required',
            `Our studio encountered an unexpected delay while rendering this storybook.
            <br><br>
            ${job.refundStatus === 'initiated' ? 'A full refund has been automatically initiated to your original payment method.' : 'Our support engineering team has been alerted.'}
            <br><br>
            Please reach out directly to <a href="mailto:support@twinkletaleai.com" style="color:#1B4938;font-weight:bold;">support@twinkletaleai.com</a> and our team will ensure your book is delivered.`
        ));
    }

    // Job is completed
    const fileName = job.fileName || `twinkletale_${job.id}.pdf`;
    const localFile = path.join(booksFolder, fileName);
    const forceDownload = req.query.download === '1' || req.query.download === 'true';
    const dispositionType = forceDownload ? 'attachment' : 'inline';

    // 1. Primary fast path: Stream directly from local disk if present
    if (fs.existsSync(localFile) && fs.statSync(localFile).size > 0) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${dispositionType}; filename="${fileName}"`);
        return res.sendFile(localFile);
    }

    // 2. Cloud Storage retrieval: Stream from Supabase into local cache, then send
    if (supabase && job.fileName) {
        try {
            console.log(`☁️ [SUPABASE] Downloading ${job.fileName} to local cache to stream to user...`);
            const { data: pdfBlob, error: dlErr } = await supabase.storage.from('storybooks').download(job.fileName);
            if (!dlErr && pdfBlob) {
                const buf = Buffer.from(await pdfBlob.arrayBuffer());
                if (buf.length > 0) {
                    try { fs.writeFileSync(localFile, buf); } catch (_) {}
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', `${dispositionType}; filename="${fileName}"`);
                    return res.send(buf);
                }
            } else if (dlErr) {
                console.warn(`⚠️ [SUPABASE] Download notice for ${job.fileName}:`, dlErr.message);
            }
        } catch (dlEx) {
            console.warn(`⚠️ [SUPABASE] Download exception for ${job.fileName}:`, dlEx.message);
        }

        // 3. Fallback: Generate a fresh 30-day pre-signed Supabase URL and redirect
        try {
            const signedRes = await supabase.storage.from('storybooks').createSignedUrl(job.fileName, 2592000);
            if (signedRes && signedRes.data && signedRes.data.signedUrl) {
                console.log(`🔗 Fresh 30-day signed URL generated for Job ${jobId}`);
                return res.redirect(signedRes.data.signedUrl);
            }
        } catch (supErr) {
            console.warn(`⚠️ Supabase signed URL generation notice for Job ${jobId}:`, supErr.message);
        }
    }

    // 4. Fallback to directPdfUrl or stored pdfUrl if valid external URL
    if (job.directPdfUrl && job.directPdfUrl.startsWith('http') && !job.directPdfUrl.includes('/api/download/')) {
        return res.redirect(job.directPdfUrl);
    }
    if (job.pdfUrl && job.pdfUrl.startsWith('http') && !job.pdfUrl.includes('/api/download/')) {
        return res.redirect(job.pdfUrl);
    }

    return res.status(404).send(renderDownloadHtmlMessage(
        'Storybook File Unavailable',
        'The storybook file could not be retrieved at this moment. Please contact our support team at <a href="mailto:support@twinkletaleai.com" style="color:#1B4938;font-weight:bold;">support@twinkletaleai.com</a> for an immediate replacement link.'
    ));
}

function renderDownloadHtmlMessage(title, message, autoRefresh = false) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} | TwinkleTale</title>
    ${autoRefresh ? '<meta http-equiv="refresh" content="12">' : ''}
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #FAF7F2; color: #161B33; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #FFFFFF; max-width: 520px; width: 100%; padding: 40px 32px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); text-align: center; border: 1px solid #EAE4D9; }
        h1 { font-size: 24px; font-weight: 700; margin-top: 0; margin-bottom: 16px; color: #161B33; font-family: Georgia, serif; }
        p { font-size: 15px; line-height: 1.6; color: #4A5568; margin-bottom: 24px; }
        .spinner { width: 44px; height: 44px; border: 4px solid #E2E8F0; border-top-color: #D4AF37; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .btn { display: inline-block; background: #1B4938; color: #FAF7F2; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; transition: opacity 0.2s; }
        .btn:hover { opacity: 0.9; }
        .footer-note { font-size: 12px; color: #A0AEC0; margin-top: 24px; }
    </style>
</head>
<body>
    <div class="card">
        ${autoRefresh ? '<div class="spinner"></div>' : ''}
        <h1>${title}</h1>
        <p>${message}</p>
        ${autoRefresh ? '<a href="" class="btn">🔄 Refresh Status</a>' : '<a href="/" class="btn">Back to TwinkleTale</a>'}
        <div class="footer-note">TwinkleTale Studios • Magical Bedtime Keepsakes</div>
    </div>
</body>
</html>`;
}

app.get('/api/download/:jobId', handleDownloadStorybook);
app.get('/download/:jobId', handleDownloadStorybook);

// ====================================================================
// ASYNC BACKGROUND FULFILLMENT WORKER (MULTILINGUAL + SPREAD LAYOUT)
// ====================================================================
async function assembleFullBookAsync(jobId, session, bookLength, parentEmail, protocol, host) {
    const update = (progress, step) => {
        const j = getJob(jobId) || { id: jobId, timestamp: Date.now() };
        j.progress = progress;
        j.step = step;
        saveJob(jobId, j);
    };

    try {
        session = session || {};
        const childName = session.childName || 'Child';
        const gender = session.gender || 'hero';
        const age = session.age || 5;
        const theme = session.theme || 'Story';
        const language = session.language || 'English';
        const photoData = session.photoData || null;
        const dedication = session.dedication || '';
        const charAnchor = session.charAnchor || 'adorable child hero in luminous painterly picture book art';
        const pronoun = session.pronoun || 'they';
        const pal = session.pal || themeKit(theme);
        const title = session.title || session.bookTitle || `${childName}'s Adventure`;
        const scenesData = session.scenesData || [];
        const base = String(theme || 'Story').split(' (')[0];

        const scenes = getSceneCount(bookLength);
        console.log(`📖 Async Assembly Job ${jobId} | ${childName} | scenes=${scenes} | Lang=${language}`);
        const startUpscales = bookUpscalesCount;

        // Initialize Order Manifest for cost, model, and quality audit
        const manifest = new OrderGenerationManifest(jobId, session.previewId);
        if (session.characterMaster) manifest.setCharacterMaster(session.characterMaster);
        if (session.characterSheet) manifest.setCharacterSheet(session.characterSheet);

        // If direct checkout, generate bespoke story scenes via LLM if not already available
        let activeScenes = Array.isArray(scenesData) && scenesData.length > 0 ? scenesData : [];
        if (activeScenes.length === 0) {
            update(10, 'Authoring personalized bedtime story...');
            try {
                const charDetails = getCharacterDetails(childName, gender, age, theme);
                const activeOutfit = charDetails.outfit;
                const sysPrompt = `You are an award-winning children's author. Write a charming ${scenes}-scene bedtime story for a child named ${childName} (${gender}, age ${age}) about ${theme}. Character signature outfit: ${activeOutfit}. Language: ${language}. Return JSON with scenes array containing { scene_title, page_text, image_prompt }. Each image_prompt should describe the child's action in this scene while maintaining their signature appearance.`;
                const userPrompt = `Generate a ${scenes}-scene bedtime story for ${childName} in ${language}.`;
                const rawStory = await callStoryLLM(sysPrompt, userPrompt, language);
                const parsed = JSON.parse(rawStory.replace(/```json/g, '').replace(/```/g, '').trim());
                activeScenes = Array.isArray(parsed) ? parsed : (parsed.scenes || parsed.story_scenes || []);
                console.log(`✨ Direct checkout story authored: ${activeScenes.length} scenes`);
            } catch (llmErr) {
                console.warn('⚠️ Direct checkout LLM story fallback notice:', llmErr.message);
            }
        }

        let pdfDoc = await PDFDocument.create();
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
        const frameCachePath = path.join(booksFolder, `frame_cache_${base.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
        let frameImgBuffer = null;
        if (fs.existsSync(frameCachePath)) {
            try {
                frameImgBuffer = fs.readFileSync(frameCachePath);
                console.log(`🖼️ [FRAME CACHE] Loaded cached decorative frame for theme: ${base}`);
            } catch (_) {}
        }
        if (!frameImgBuffer) {
            const framePrompt = STYLE + `decorative rectangular border frame for a children's book page, repeating hand-painted motifs of ${pal.motifs} woven with ribbons and leaves around all four edges, wide plain warm cream empty center occupying seventy percent of the page, soft pastel palette, gentle textures`;
            frameImgBuffer = await withRetry('frame image', async () => fetchImageBuffer(await generateImage(framePrompt, null)));
            try { fs.writeFileSync(frameCachePath, frameImgBuffer); } catch (_) {}
        }
        const frameImg = await embedImageBuffer(pdfDoc, frameImgBuffer, 'decorative frame');
        if (PACING > 0) await sleep(PACING);

        // Dynamically analyze frame background luminance for guaranteed text readability
        const frameBgStats = await analyzeFrameBackground(frameImgBuffer);
        const textColors = getContrastingTextColors(frameBgStats.r, frameBgStats.g, frameBgStats.b, pal);

        // ================= PAGE 1: FRONT COVER (THEME BORDER & MEDALLION) =================
        update(30, 'Binding theme-framed front cover...');
        let coverImgBuffer = session.coverBuffer;

        // PRD FR-5: Strict Parity Check — Cloud storage first (survives restarts/TTL), then disk cache
        if (!coverImgBuffer && session.coverUrl && typeof session.coverUrl === 'string' && session.coverUrl.startsWith('http')) {
            console.log(`🔒 [COVER PARITY] Fetching durable preview cover from cloud URL: ${session.coverUrl}`);
            try {
                coverImgBuffer = await fetchImageBuffer(session.coverUrl);
                if (coverImgBuffer && coverImgBuffer.length > 1000) {
                    session.coverIsComposited = true;
                }
            } catch (e) {
                console.warn(`⚠️ [COVER PARITY] Could not fetch cover from cloud URL (${session.coverUrl}):`, e.message);
            }
        }

        if (!coverImgBuffer && session.previewId) {
            const diskCoverPath = path.join(booksFolder, `preview_${session.previewId}_cover.png`);
            if (fs.existsSync(diskCoverPath)) {
                try {
                    console.log(`🔒 [COVER PARITY] Loaded preview cover from local disk cache: ${diskCoverPath}`);
                    coverImgBuffer = fs.readFileSync(diskCoverPath);
                    session.coverIsComposited = true;
                } catch (e) {
                    console.warn(`⚠️ [COVER PARITY] Could not read disk cover:`, e.message);
                }
            }
        }

        if (!coverImgBuffer) {
            console.warn(`🚨 [CRITICAL PARITY WARNING] Cover regeneration triggered for session ${session.previewId || 'unknown'}. Preview cover could not be found.`);
            if (IS_COVER_V2) {
                console.log(`🎨 [Cover Reimagination Fallback] Regenerating full-bleed spotlight cover for ${childName}...`);
                const coverResult = await withRetry('reimagined cover generation fallback', async () => {
                    return await coverEngine.generateCover({
                        theme: base,
                        childName,
                        gender: session.gender,
                        age: session.age,
                        charAnchor,
                        bookTitle: session.bookTitle || title,
                        language,
                        photoData
                    });
                }, 2, 3000);
                coverImgBuffer = coverResult.coverBuffer;
                session.coverIsComposited = true;
            } else {
                console.log("  → [V1 Fallback] Generating theme border & child medallion...");
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
        }

        manifest.recordCover({
            reused: !!(session.coverIsComposited !== false && !session.wasCoverRegenerated),
            model: 'black-forest-labs/flux-kontext-pro'
        });

        const cover = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });

        if (session.coverIsComposited !== false && coverImgBuffer) {
            // Enhanced Cover Processing for Final Book (Ensures maximum print DPI & sharpness)
            // Preview cover is already 4K AI upscaled; only upscale if explicitly needed (e.g. fallback regeneration)
            if (process.env.UPSCALE_IMAGES !== 'false' && session.needsCoverUpscale && session.coverUrl && session.coverUrl.startsWith('http') && !session.coverUrl.includes('localhost') && !session.coverUrl.includes('127.0.0.1')) {
                try {
                    console.log(`✨ [COVER ENHANCEMENT] Running cover through 4K AI upscaler: ${session.coverUrl}`);
                    const upscaledCoverUrl = await upscaleImageWithFallback(session.coverUrl, true);
                    if (upscaledCoverUrl && upscaledCoverUrl !== session.coverUrl) {
                        coverImgBuffer = await fetchImageBuffer(upscaledCoverUrl);
                        console.log(`✅ [COVER ENHANCEMENT] 4K AI cover upscale complete!`);
                    }
                } catch (upErr) {
                    console.warn(`⚠️ [COVER ENHANCEMENT] AI upscale notice, falling back to high-res Sharp enhancement:`, upErr.message);
                }
            }

            // High-fidelity print enhancement: 1200x1600 (200 DPI print-fidelity for 600x800 pt page)
            // Uses JPEG with 4:4:4 chroma subsampling at 92 quality, cutting RAM by ~80MB vs uncompressed PNG
            try {
                coverImgBuffer = await sharp(coverImgBuffer)
                    .resize(1200, 1600, {
                        fit: 'cover'
                    })
                    .sharpen({ sigma: 1.0, m1: 0.5, m2: 0.5 })
                    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
                    .toBuffer();
                console.log(`✅ [COVER PRINT ENHANCEMENT] Final book cover enhanced to 1200x1600 (JPEG 92 4:4:4) for crisp print perfection & minimal RAM.`);
            } catch (sharpErr) {
                console.warn(`⚠️ [COVER PRINT ENHANCEMENT] Sharp enhancement notice:`, sharpErr.message);
            }

            // High-resolution unified cover composite (identical to approved preview)
            const coverImg = await embedImageBuffer(pdfDoc, coverImgBuffer, 'cover');
            cover.drawImage(coverImg, coverFit(coverImg, PAGE_W, PAGE_H));
            coverImgBuffer = null;
            if (global.gc) global.gc();
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
                const d = PDF_Z.medal.r * 2;
                const fit = coverFit(vigImg, d, d);
                const dx = (PDF_Z.medal.cx - PDF_Z.medal.r) + fit.x;
                const dy2 = (PDF_Z.medal.cy - PDF_Z.medal.r) + fit.y;
                cover.drawImage(vigImg, { x: dx, y: dy2, width: fit.width, height: fit.height });
                cover.drawEllipse({ x: PDF_Z.medal.cx, y: PDF_Z.medal.cy, xScale: PDF_Z.medal.r + 5, yScale: PDF_Z.medal.r + 5, borderColor: pal.accent, borderWidth: 3.5 });
                cover.drawEllipse({ x: PDF_Z.medal.cx, y: PDF_Z.medal.cy, xScale: PDF_Z.medal.r + 11, yScale: PDF_Z.medal.r + 11, borderColor: pal.accent, borderWidth: 1.5, borderOpacity: 0.7 });
            }

            // Top Name Plaque (framed by top foliage arch)
            const topLabel = isNonLatin(childName) ? `${childName}` : `${childName}'s`;
            const topFont = chooseFont(topLabel, bookFont, serifBI);
            drawFlowLine(cover, topLabel, PDF_Z.name.y, 42, topFont, pal.accent, 2);

            // Lower Title (safely below medallion - ZERO OVERLAP)
            const bookTitle = session.bookTitle || title || `${childName}'s Adventure`;
            const titleFont = chooseFont(bookTitle, bookFont, serifB);
            let tSize = 36;
            let tLines = wrapText(bookTitle, titleFont, tSize, 470);
            if (tLines.length > 3) { tSize = 30; tLines = wrapText(bookTitle, titleFont, tSize, 470); }
            let ty = PDF_Z.title.y;
            for (const line of tLines) {
                drawFlowLine(cover, line, ty, tSize, titleFont, rgb(0.99, 0.98, 0.94), 2.5);
                ty -= 42;
            }

            // Bottom Keepsake Banner (Safe print margin)
            drawCentered(cover, 'TwinkleTale Keepsake Treasury', PDF_Z.footer.y, 11, serifI, pal.accent, 0.95);
            drawVectorStar(cover, PAGE_W / 2 - 115, PDF_Z.footer.y, 5, 5, 2.2, pal.accent);
            drawVectorStar(cover, PAGE_W / 2 + 115, PDF_Z.footer.y, 5, 5, 2.2, pal.accent);
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
                accentColor: rgbToHex(textColors.accentColor),
                inkColor: rgbToHex(textColors.bodyColor),
                coverColor: rgbToHex(textColors.titleColor)
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
            drawCentered(dedPage, 'TWINKLETALE KEEPSAKE TREASURY', 665, 10, serifB, textColors.accentColor, 0.95);
            drawVectorDiamond(dedPage, PAGE_W / 2, 648, 6, textColors.accentColor);

            const dedTitleFont = chooseFont(dedTitle, bookFont, serifB);
            let dtSize = 26;
            let dtLines = wrapText(dedTitle, dedTitleFont, dtSize, 420);
            if (dtLines.length > 2) { dtSize = 22; dtLines = wrapText(dedTitle, dedTitleFont, dtSize, 420); }
            let dty = 612;
            for (const line of dtLines) {
                drawCentered(dedPage, line, dty, dtSize, dedTitleFont, textColors.titleColor);
                dty -= 34;
            }

            const rhymeFont = chooseFont(rhyme, bookFont, serifI);
            const rhymeLines = wrapText(rhyme, rhymeFont, 14, 400);
            let ry = dty - 16;
            for (const line of rhymeLines) {
                drawCentered(dedPage, line, ry, 14, rhymeFont, textColors.bodyColor, 0.95);
                ry -= 24;
            }

            // Golden divider
            dedPage.drawLine({ start: { x: 140, y: ry - 12 }, end: { x: PAGE_W - 140, y: ry - 12 }, color: textColors.accentColor, thickness: 1, opacity: 0.6 });
            drawVectorStar(dedPage, PAGE_W / 2, ry - 12, 5, 8, 3.5, textColors.accentColor);

            // Personalized Parent Dedication Block
            const dedForFont = chooseFont(forLabel, bookFont, serifB);
            drawCentered(dedPage, forLabel, ry - 40, 16, dedForFont, textColors.titleColor);

            const dedMsgFont = chooseFont(dedMsg, bookFont, serifI);
            const dedMsgLines = wrapText(dedMsg, dedMsgFont, 13, 390);
            let my = ry - 68;
            for (const line of dedMsgLines) {
                drawCentered(dedPage, line, my, 13, dedMsgFont, textColors.bodyColor, 0.9);
                my -= 22;
            }
        }

        // Keepsake footer
        drawCentered(dedPage, 'TwinkleTale Studios • Keepsake Treasury Edition', 70, 9, serif, textColors.subtextColor, 0.7);

        // Character Traits & Consistent Wardrobe Anchors
        const charDetails = getCharacterDetails(childName, gender, age, theme);
        const bookAttributes = session.attributes || (photoData ? await extractPhotoVisualAttributes(photoData) : {});
        if (bookAttributes && (bookAttributes.hasHeadwear || bookAttributes.hasGlasses || bookAttributes.skinTone)) {
            Object.assign(charDetails, getCharacterDetails(childName, gender, age, theme, bookAttributes));
        }
        const activeCharAnchor = charAnchor || charDetails.charAnchor;
        const activeOutfit = charDetails.outfit;

        // Ensure Character Master v1 is established
        let characterProfile = session.characterProfile || null;
        let characterMaster = session.characterMaster || null;
        let characterSheet = session.characterSheet || null;

        if (!characterMaster && photoData) {
            try {
                if (!characterProfile) {
                    characterProfile = createCharacterProfile({
                        childName,
                        gender,
                        age,
                        theme,
                        attributes: bookAttributes,
                        photoData,
                        charAnchor: activeCharAnchor,
                        outfit: activeOutfit
                    });
                    session.characterProfile = characterProfile;
                }
                characterMaster = await getOrGenerateCharacterMaster({
                    photoData,
                    profile: characterProfile,
                    generateImageFn: (p, pd, opt) => generateImage(p, pd, opt)
                });
                if (characterMaster) {
                    session.characterMaster = characterMaster;
                    manifest.setCharacterMaster(characterMaster);
                    manifest.recordAiCall({
                        stage: 'character_master',
                        model: 'black-forest-labs/flux-kontext-pro',
                        reason: 'full_book_character_master_init',
                        outputAssetId: characterMaster.masterUrl
                    });
                }
            } catch (cmErr) {
                console.warn('⚠️ [CharacterMaster] Could not establish Master in assembleFullBookAsync:', cmErr.message);
            }
        }

        // Validate or fallback scenes
        const effectiveScenes = (activeScenes || []).slice(0, scenes);
        while (effectiveScenes.length < scenes) {
            const idx = effectiveScenes.length + 1;
            effectiveScenes.push({
                scene_title: `Magical Wonder ${idx}`,
                page_text: `Under the soft glow of twilight, ${childName} discovered a world full of kindness and starlight, smiling as their adventure continued with wonder and joy.`,
                image_prompt: `whimsical storybook scene of ${activeCharAnchor} exploring magical glowing landscapes full of wonder`
            });
        }

        // PRD FR-1 & FR-3: Identity Anchor setup
        // CRITICAL IDENTITY CONSISTENCY:
        // Prioritize Character Master v1 (canonical stylized 1:1 portrait), then reference portrait, then uploaded photo.
        // Conditioning on the Character Master ensures identical facial contours, eye shape, smile, skin tone,
        // hair texture, glasses, and cultural headwear across both Cover and all interior scenes.
        let visualCondition = photoData || session.photoData || null;
        if (characterMaster && characterMaster.masterUrl) {
            visualCondition = characterMaster.masterUrl;
        } else if (!visualCondition && session.referencePortraitUrl) {
            visualCondition = session.referencePortraitUrl;
        } else if (!visualCondition) {
            try {
                console.log("🎨 Generating locked reference portrait for text-only book session...");
                session.referencePortraitUrl = await generateAvatar(null, activeCharAnchor, bookAttributes);
                visualCondition = session.referencePortraitUrl;
            } catch (err) {
                console.warn("⚠️ Could not generate locked reference portrait:", err.message);
            }
        }
        let referencePortrait = visualCondition;

        // ================= INTERIOR SPREADS: ILLUSTRATION GENERATION (SEQUENTIAL & MEMORY-SAFE) =================
        // Process one scene at a time with native resolution (upscale: false) to keep RAM < 150MB on Render
        const sceneFilePaths = new Array(scenes);
        const pageQaBudget = new PageRegenerationBudget(MAX_PAGE_QUALITY_REGENERATIONS);

        for (let i = 0; i < scenes; i++) {
            const currentSceneNum = i + 1;
            const pct = Math.round(35 + (i / scenes) * 55);
            update(pct, `Illustrating story scene ${currentSceneNum} of ${scenes}...`);
            console.log(`  → Illustrating scene ${currentSceneNum} of ${scenes} (Native 1024x1365, upscale: false, memory-safe)...`);

            const scene = effectiveScenes[i];
            let rawPrompt = sanitizePromptForSafety(scene.image_prompt || `${activeCharAnchor} with a joyful smile in the scene: ${scene.scene_title}`);
            if (childName && childName.length > 1) {
                const nameRegex = new RegExp(`\\b${childName}\\b`, 'gi');
                rawPrompt = rawPrompt.replace(nameRegex, (gender === 'little star') ? 'the child' : `the little ${charDetails.genderClean || 'hero'}`);
            }

            let attributePrefix = '';
            let attributeNegative = '';
            if (bookAttributes && bookAttributes.hasHeadwear) {
                const rawHeadwear = String(bookAttributes.headwearDescription || (bookAttributes.headwearType && bookAttributes.headwearType !== 'none' ? bookAttributes.headwearType : '')).trim();
                if (rawHeadwear) {
                    const cleanHeadwear = rawHeadwear.replace(/^authentic\s+/i, '');
                    attributePrefix += `(wearing an authentic ${cleanHeadwear}:1.35), `;
                    attributeNegative += `Strict cultural requirement: Preserve the child's authentic ${cleanHeadwear} in this scene; do NOT add any hat, cap, or generic headwear. `;
                }
            } else {
                attributeNegative += `Strict physical requirement: The child has natural hair with NO headwear; do NOT add any hat, cap, crown, or head covering. `;
            }
            if (bookAttributes && bookAttributes.hasGlasses) {
                attributePrefix += `(wearing ${bookAttributes.glassesDescription || 'spectacles'}:1.3), `;
            } else {
                attributeNegative += `Strict physical requirement: The child does NOT wear glasses; do NOT add any spectacles, glasses, sunglasses, or frames. `;
            }
            attributeNegative += `Strict physical likeness: Maintain the child's natural appearance as-is from the photo without adding any extra props or accessories. `;
            if (bookAttributes && bookAttributes.skinTone) {
                attributePrefix += `(authentic ${bookAttributes.skinTone} skin:1.2), `;
            }

            const identityDirective = (IS_V2 && visualCondition)
                ? `${attributePrefix}Masterpiece modern children's picture book illustration in award-winning painterly realism, fine digital gouache and soft luminous artisan oils: featuring the exact same ${charDetails.genderClean || 'hero'} from the reference character portrait (${activeCharAnchor}), ${attributeNegative}preserving 80-90% facial likeness and identity: identical facial structure, eye shape, eyebrows, nose, mouth, authentic cheerful smile, natural skin tone, hair texture, and consistently ${activeOutfit}. In this scene: ${rawPrompt}`
                : `Masterpiece modern children's picture book illustration in award-winning painterly realism, fine digital gouache and soft luminous artisan oils: featuring ${activeCharAnchor}, consistently ${activeOutfit}. In this scene: ${rawPrompt}`;
            const scenePrompt = STYLE + identityDirective;

            // Generate native image without heavy 4K Real-ESRGAN upscaler to save ~6s and ~85MB RAM per scene
            let rawUrl;
            let attempts = 0;
            let qualityRegenerations = 0;
            const tSceneStart = Date.now();

            try {
                attempts++;
                rawUrl = await withRetry(`scene ${i + 1} image`, async () => generateImage(scenePrompt, visualCondition, { isFace: true, upscale: false }));
                manifest.recordAiCall({
                    stage: 'page_generation',
                    page: currentSceneNum,
                    model: 'black-forest-labs/flux-kontext-pro',
                    reason: 'initial_generation',
                    attempt: attempts,
                    latencyMs: Date.now() - tSceneStart,
                    success: !!rawUrl
                });
            } catch (sceneErr) {
                console.warn(`⚠️ Scene ${i + 1} illustration notice (${sceneErr.message}). Gracefully recovering via locked character reference anchor...`);
                const fallbackPrompt = STYLE + `Masterpiece modern children's picture book illustration in award-winning painterly realism, fine digital gouache: featuring a cheerful young ${charDetails.genderClean || 'hero'} in ${activeOutfit}, smiling happily in this scene: ${rawPrompt}`;
                try {
                    attempts++;
                    rawUrl = await generateImage(fallbackPrompt, session.referencePortraitUrl || null, { isFace: true, upscale: false });
                    manifest.recordAiCall({
                        stage: 'page_generation',
                        page: currentSceneNum,
                        model: 'black-forest-labs/flux-kontext-pro',
                        reason: 'fallback_reference_portrait',
                        attempt: attempts,
                        latencyMs: Date.now() - tSceneStart,
                        success: !!rawUrl
                    });
                } catch (refErr) {
                    console.warn(`⚠️ Scene ${i + 1} reference fallback notice (${refErr.message}). Recovering via pure text-to-image prompt...`);
                    attempts++;
                    rawUrl = await generateImage(fallbackPrompt, null, { isFace: false, upscale: false });
                    manifest.recordAiCall({
                        stage: 'page_generation',
                        page: currentSceneNum,
                        model: 'black-forest-labs/flux-1.1-pro',
                        reason: 'fallback_text_to_image',
                        attempt: attempts,
                        latencyMs: Date.now() - tSceneStart,
                        success: !!rawUrl
                    });
                }
            }
            let rawBuf = null;
            if (rawUrl) {
                try {
                    rawBuf = await fetchImageBuffer(rawUrl);
                } catch (bufErr) {
                    console.warn(`⚠️ Scene ${i + 1} buffer download notice (${bufErr.message}). Retrying once...`);
                    try {
                        await sleep(1500);
                        rawBuf = await fetchImageBuffer(rawUrl);
                    } catch (bufErr2) {
                        console.warn(`⚠️ Scene ${i + 1} buffer second download attempt failed: ${bufErr2.message}`);
                    }
                }
            }

            // Quality Assurance & Budgeted Single Regeneration
            const qaResult = await validateImageQuality(rawBuf, { minBytes: 1000, expectedRatio: 0.75 });
            if (!qaResult.valid && pageQaBudget.canRegenerate(i)) {
                pageQaBudget.recordAttempt(i);
                qualityRegenerations++;
                console.warn(`⚠️ [CharacterQA] Scene ${currentSceneNum} failed QA (${qaResult.reason}). Retrying once under budget...`);
                const tQaRetry = Date.now();
                try {
                    attempts++;
                    const retryUrl = await generateImage(scenePrompt, visualCondition, { isFace: true, upscale: false });
                    if (retryUrl) {
                        const retryBuf = await fetchImageBuffer(retryUrl);
                        const retryQa = await validateImageQuality(retryBuf, { minBytes: 1000, expectedRatio: 0.75 });
                        if (retryQa.valid) {
                            rawBuf = retryBuf;
                            rawUrl = retryUrl;
                        }
                    }
                    manifest.recordAiCall({
                        stage: 'page_generation',
                        page: currentSceneNum,
                        model: 'black-forest-labs/flux-kontext-pro',
                        reason: `qa_regeneration_${qaResult.reason}`,
                        attempt: attempts,
                        latencyMs: Date.now() - tQaRetry,
                        success: true
                    });
                } catch (qaRetryErr) {
                    console.warn(`⚠️ [CharacterQA] Scene ${currentSceneNum} QA retry error: ${qaRetryErr.message}`);
                }
            }

            // Fail-safe buffer recovery: Ensure rawBuf is always a valid image before passing to Sharp
            if (!rawBuf || !Buffer.isBuffer(rawBuf) || rawBuf.length < 500) {
                console.warn(`⚠️ Scene ${currentSceneNum} buffer missing or corrupted. Generating text-to-image emergency recovery...`);
                try {
                    const emergPrompt = STYLE + `Masterpiece modern children's picture book illustration in award-winning painterly realism, fine digital gouache: featuring a cheerful young ${charDetails.genderClean || 'hero'} in ${activeOutfit}, smiling happily in this scene: ${rawPrompt}`;
                    const emergUrl = await generateImage(emergPrompt, null, { isFace: false, upscale: false });
                    if (emergUrl) rawBuf = await fetchImageBuffer(emergUrl);
                } catch (emergErr) {
                    console.warn(`⚠️ Scene ${currentSceneNum} emergency generation notice: ${emergErr.message}`);
                }
            }

            // Ultimate fail-safe: synthesize illustrated story background if all AI generations fail
            if (!rawBuf || !Buffer.isBuffer(rawBuf) || rawBuf.length < 500) {
                console.warn(`⚠️ Scene ${currentSceneNum} using decorative frame background canvas fail-safe...`);
                try {
                    rawBuf = frameImgBuffer || (await sharp({
                        create: { width: 1200, height: 1600, channels: 3, background: { r: 250, g: 247, b: 242 } }
                    }).jpeg({ quality: 90 }).toBuffer());
                } catch (_) {
                    rawBuf = Buffer.alloc(0);
                }
            }

            manifest.recordPage({
                page: currentSceneNum,
                attempts,
                qualityRegenerations,
                upscaleCalls: 0,
                latencyMs: Date.now() - tSceneStart
            });

            // Memory-optimized 1200x1600 JPEG compression for 300 DPI print quality (<400KB per page on disk)
            const sceneDiskPath = path.join(booksFolder, `temp_scene_${jobId}_${i}.jpg`);
            await sharp(rawBuf)
                .resize(1200, 1600, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 90 })
                .toFile(sceneDiskPath);
            rawBuf = null;
            if (global.gc) global.gc();

            sceneFilePaths[i] = sceneDiskPath;

            if (PACING > 0 && i < scenes - 1) {
                await sleep(PACING);
            }
        }

        // ================= COMPILE SPREADS IN DETERMINISTIC ORDER =================
        let spreadIndex = 1;
        for (let i = 0; i < scenes; i++) {
            const scene = effectiveScenes[i];
            const sceneFilePath = sceneFilePaths[i];
            let sceneImgBuf = null;
            if (fs.existsSync(sceneFilePath)) {
                sceneImgBuf = fs.readFileSync(sceneFilePath);
            }
            if (!sceneImgBuf) {
                throw new Error(`Scene image file missing for scene ${i + 1}`);
            }
            const sceneImg = await embedImageBuffer(pdfDoc, sceneImgBuf, `scene ${i + 1}`);
            sceneImgBuf = null;

            // Clean up temporary disk file immediately after embedding to keep disk lean
            try { fs.unlinkSync(sceneFilePath); } catch (_) {}
            if (global.gc) global.gc();

            // LEFT PAGE: Full-bleed Scene Illustration
            const imgPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            imgPage.drawImage(sceneImg, coverFit(sceneImg, PAGE_W, PAGE_H));

            // RIGHT PAGE: Framed Verse Page
            const textPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            textPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
            textPage.drawImage(frameImg, coverFit(frameImg, PAGE_W, PAGE_H));

            // Verse Page Content (Dynamically contrast-adjusted based on frame background luminance)
            let verseRendered = false;
            if (isNonLatin(scene.page_text) || isNonLatin(scene.scene_title)) {
                const versePngBuf = await renderVersePagePng(scene.scene_title, scene.page_text, {
                    titleColor: rgbToHex(textColors.titleColor),
                    accentColor: rgbToHex(textColors.accentColor),
                    textColor: rgbToHex(textColors.bodyColor)
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
                // Scene Title
                const sceneTitleFont = chooseFont(scene.scene_title, bookFont, serifB);
                drawCentered(textPage, scene.scene_title, 610, 26, sceneTitleFont, textColors.titleColor);
                drawVectorDiamond(textPage, PAGE_W / 2, 576, 8, textColors.accentColor);

                // Verse Text
                const verseFont = chooseFont(scene.page_text, bookFont, serif);
                const verseLines = wrapText(scene.page_text, verseFont, 18, 400);
                let by = 520 - ((520 - 180) - verseLines.length * 32) / 2;
                for (const line of verseLines) {
                    drawCentered(textPage, line, by, 18, verseFont, textColors.bodyColor);
                    by -= 32;
                }
            }

            // Spread Number
            drawCentered(textPage, `— ${spreadIndex} —`, 100, 12, serif, textColors.subtextColor, 0.75);
            spreadIndex++;
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
        const finalPageCount = pdfDoc.getPageCount();
        if (finalPageCount !== expectedPages) {
            throw new Error(`PAGE COUNT GUARDRAIL VIOLATION: Expected exactly ${expectedPages} pages but generated ${finalPageCount}`);
        }

        // ================= SAVE & UPLOAD =================
        update(97, 'Saving print-ready PDF...');
        const pdfBytes = await pdfDoc.save();
        pdfDoc = null; // Release full PDF Document and embedded page objects from heap
        if (global.gc) global.gc();
        const safeName = String(childName).replace(/[^a-zA-Z0-9_-]/g, '_');
        const cryptToken = crypto.randomBytes(16).toString('hex');
        const fileName = `twinkletale_${safeName}_${cryptToken}.pdf`;
        let pdfUrl = null;
        let signedSupabaseUrl = null;

        // 1. Always save locally to booksFolder first to guarantee local streaming availability
        const localFilePath = path.join(booksFolder, fileName);
        fs.writeFileSync(localFilePath, pdfBytes);
        console.log("💾 Saved locally:", localFilePath);

        // 2. Upload to Supabase permanent cloud storage with 30-day pre-signed URL (2,592,000 seconds)
        if (supabase) {
            update(98, 'Uploading to permanent cloud storage...');
            const cloudUpload = await uploadToStorage(fileName, pdfBytes, 'application/pdf');
            if (cloudUpload && cloudUpload.finalUrl) {
                pdfUrl = cloudUpload.finalUrl;
                signedSupabaseUrl = cloudUpload.signedUrl;
                console.log("☁️ Saved permanently to Supabase (30-day signed URL):", pdfUrl);
            } else {
                console.warn("⚠️ Supabase upload notice: Cloud upload returned no URL — using fallback");
            }
        }
        if (!pdfUrl) {
            pdfUrl = `${protocol}://${host}/books/${fileName}`;
        }

        // 3. Construct permanent download endpoint URL
        const effectiveProtocol = (protocol === 'https' || (process.env.NODE_ENV === 'production' && !host.includes('localhost'))) ? 'https' : protocol;
        const persistentDownloadUrl = `${effectiveProtocol}://${host}/api/download/${jobId}`;

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
                            <a href="${persistentDownloadUrl}" target="_blank" style="background:#1B4938;color:#FAF7F2;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;display:inline-block">📥 Download Print-Ready Storybook (PDF)</a>
                        </p>
                        <p style="font-size:13px;color:#777;line-height:1.5">You can read this on any phone, iPad, tablet, or print it out on A4/Letter paper to make a physical bedside book.</p>
                        <hr style="border:none;border-top:1px solid #DDD;margin:24px 0">
                        <p style="font-size:12px;color:#999;text-align:center">This download link is permanent and never expires.<br>Need assistance? Contact our team at <a href="mailto:support@twinkletaleai.com" style="color:#666;text-decoration:underline;">support@twinkletaleai.com</a>.<br>Crafted with love by TwinkleTale Studios.</p>
                    </div>`
                });
                emailed = true;
                console.log("📧 Delivery email sent to:", parentEmail);
            } catch (e) {
                console.log("⚠️ Email delivery notice:", e.message);
            }
        }

        const job = getJob(jobId) || { id: jobId, timestamp: Date.now() };
        job.status = 'completed';
        job.progress = 100;
        job.step = 'Your storybook is ready!';
        job.pdfUrl = persistentDownloadUrl;
        job.directPdfUrl = pdfUrl;
        job.supabaseUrl = signedSupabaseUrl;
        job.fileName = fileName;
        job.childName = childName;
        job.title = title;
        job.emailed = emailed;
        job.completedAt = Date.now();
        saveJob(jobId, job);
        if (supabase) {
            await uploadToStorage(`metadata/job_${jobId}.json`, Buffer.from(JSON.stringify(job)), 'application/json');
        }

        // Finalize and persist Generation Manifest for complete observability & cost auditing
        manifest.finalize();
        manifest.saveToDisk(booksFolder);
        if (supabase) {
            try {
                await uploadToStorage(`manifests/manifest_${jobId}.json`, Buffer.from(JSON.stringify(manifest.toJSON())), 'application/json');
            } catch (_) {}
        }

        const jobUpscales = bookUpscalesCount - startUpscales;
        const estUpscaleCost = (jobUpscales * 0.04).toFixed(2);
        console.log(`💰 Estimated upscale cost for Job ${jobId}: $${estUpscaleCost} (${jobUpscales} upscales used x ~$0.04)`);
        console.log(`🎉 Job ${jobId} Completed! Pages=${finalPageCount} | PDF: ${persistentDownloadUrl}`);
    } catch (err) {
        console.error(`❌ Job ${jobId} Failed attempt:`, err.message);
        // SAFETY GUARD: If the PDF was already generated and saved to disk, do NOT fail the job or trigger DLQ!
        const existingJob = getJob(jobId);
        if (existingJob && existingJob.status === 'completed' && existingJob.fileName) {
            const checkFile = path.join(booksFolder, existingJob.fileName);
            if (fs.existsSync(checkFile) && fs.statSync(checkFile).size > 1000) {
                console.log(`✅ [SAFETY GUARD] PDF is already saved on disk (${existingJob.fileName}). Marking job ${jobId} successfully completed despite post-save notice:`, err.message);
                return; // Gracefully complete without throwing to queue
            }
        }
        throw err; // Rethrow to BookGenerationQueue for automatic retry or DLQ
    } finally {
        const isStillRetrying = bookQueue && (
            (bookQueue.currentItem && bookQueue.currentItem.jobId === jobId && (bookQueue.currentItem.attempts || 0) < bookQueue.maxAttempts) ||
            (bookQueue.queue && bookQueue.queue.some(q => q.jobId === jobId))
        );
        if (session && !isStillRetrying) {
            session.photoData = null; // Ephemeral photo memory purged immediately for child privacy
        }
    }
}

// ====================================================================
// DIRECT BOOK GENERATION (STRICTLY GATED TO AUTHORIZED ADMIN / DEV)
// ====================================================================
app.post('/api/create-book', rateLimiter, async (req, res) => {
    // CRITICAL SECURITY GATE: Prevent unauthorized payment bypass & Replicate credit burning
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const adminToken = req.headers['x-admin-token'] || req.query.admin_token || bearerToken;

    if (!process.env.ADMIN_TOKEN || !adminToken || adminToken !== process.env.ADMIN_TOKEN) {
        console.warn(`🚨 [SECURITY ALERT] Unauthorized /api/create-book attempt blocked from IP ${req.ip || 'unknown'}`);
        return res.status(403).json({
            success: false,
            error: 'Direct book generation is strictly restricted. Please use /api/create-preview and verified checkout.'
        });
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

        let coverBuffer = null;
        let coverIsComposited = true;
        let vigUrlRaw = null;

        if (IS_COVER_V2) {
            console.log(`🎨 [Direct Book] Painting reimagined spotlight cover for ${childName} (60-65% hero area)...`);
            const coverResult = await withRetry('reimagined cover generation', async () => {
                return await coverEngine.generateCover({
                    theme: base,
                    childName,
                    gender: genderClean,
                    age: childAge,
                    charAnchor,
                    bookTitle: title,
                    language: lang,
                    photoData
                });
            }, 2, 3000);
            coverBuffer = coverResult.coverBuffer;
            vigUrlRaw = coverResult.rawArtUrl;
        } else {
            console.log("  → [V1 Fallback] Painting theme-relevant ornate border background...");
            const bgUrlRaw = await withRetry('cover background', async () => generateCoverBackground(base, pal));
            await sleep(PACING);
            console.log("  → [V1 Fallback] Painting child medallion hero...");
            vigUrlRaw = await withRetry('child medallion hero', async () => generateChildMedallion(charAnchor, base, pal, photoData));
            const [bgBuffer, vigBuffer] = await Promise.all([
                fetchImageBuffer(bgUrlRaw),
                fetchImageBuffer(vigUrlRaw)
            ]);

            coverBuffer = await renderCoverCompositePng(bgBuffer, vigBuffer, childName, title, pal, lang);
            if (!coverBuffer) {
                coverBuffer = bgBuffer;
                coverIsComposited = false;
            }
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
        let userErrorMessage = err.message;
        if (/sensitive|E005|flagged|safety/i.test(err.message)) {
            userErrorMessage = "Automated image safety filters were triggered for this photo. Please try uploading a different clear photo of your child's face (such as a portrait or school photo), or choose Skip Preview to order directly!";
        }
        res.status(500).json({ success: false, error: userErrorMessage });
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
app.use('/public', express.static(path.join(__dirname, 'public'), {
    maxAge: '7d',
    etag: true
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/special', (req, res) => {
    res.sendFile(path.join(__dirname, 'special.html'));
});

app.get('/offer', (req, res) => {
    res.sendFile(path.join(__dirname, 'special.html'));
});

// Premium High-Converting US Storefront
app.get('/us', (req, res) => {
    res.sendFile(path.join(__dirname, 'us.html'));
});

app.get('/usa', (req, res) => {
    res.sendFile(path.join(__dirname, 'us.html'));
});

// Sample Storybook PDF Download Endpoint (guaranteed Content-Disposition attachment across all devices)
app.get('/api/sample-download/:sampleId', (req, res) => {
    const sampleId = String(req.params.sampleId || '').toLowerCase();
    let fileName = '';
    let downloadName = '';
    if (sampleId === 'elizabeth') {
        fileName = 'elizabeth-treasury-of-enchanted-forest-sample.pdf';
        downloadName = 'Elizabeth-Treasury-Of-Enchanted-Forest-TwinkleTale-Sample.pdf';
    } else if (sampleId === 'liam') {
        fileName = 'liam-and-the-moonlight-carnival-sample.pdf';
        downloadName = 'Liam-And-The-Moonlight-Carnival-TwinkleTale-Sample.pdf';
    } else if (sampleId === 'radha') {
        fileName = 'radha-starlight-cosmic-voyage-sample.pdf';
        downloadName = 'Radha-Starlight-Cosmic-Voyage-TwinkleTale-Sample.pdf';
    } else if (sampleId === 'sid') {
        fileName = 'sid-dinosaur-wonder-night-sample.pdf';
        downloadName = 'Sid-Dinosaur-Wonder-Night-TwinkleTale-Sample.pdf';
    } else {
        return res.status(404).json({ error: 'Sample not found' });
    }
    const filePath = path.join(__dirname, 'public', 'samples', fileName);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Sample file missing' });
    }
    res.download(filePath, downloadName, (err) => {
        if (err && !res.headersSent) {
            console.error('❌ Sample download error:', err.message);
            res.status(500).send('Could not download sample book.');
        }
    });
});

// Health check & cloud storage verification endpoint
app.get('/api/health', async (req, res) => {
    let supabaseStatus = 'off';
    let bucketStatus = 'unknown';
    if (supabase) {
        supabaseStatus = 'connected';
        try {
            const { data, error } = await supabase.storage.listBuckets();
            bucketStatus = error ? `error: ${error.message}` : (data?.some(b => b.name === 'storybooks') ? 'ready' : 'missing');
        } catch (e) {
            bucketStatus = `exception: ${e.message}`;
        }
    }
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        supabase: supabaseStatus,
        bucket: bucketStatus,
        activeJobs: activeJobs.size,
        queueLength: bookQueue?.queue?.length || 0
    });
});

// ====================================================================
// STARTUP SELF-HEALING: RESUME INTERRUPTED JOBS OR TRIGGER FAIL-SAFE REFUND
// ====================================================================
async function recoverDanglingJobs() {
    try {
        if (!fs.existsSync(booksFolder)) return;
        const files = fs.readdirSync(booksFolder);
        const now = Date.now();

        // 1. Recover queued jobs from queue_*.json files
        for (const f of files) {
            if (f.startsWith('queue_') && f.endsWith('.json')) {
                const qPath = path.join(booksFolder, f);
                try {
                    const qItem = JSON.parse(fs.readFileSync(qPath, 'utf8'));
                    if (qItem && qItem.jobId) {
                        const existingJob = getJob(qItem.jobId);
                        if (!existingJob || existingJob.status !== 'completed') {
                            console.log(`🔄 [SELF-HEALING] Re-enqueuing interrupted queue job: ${qItem.jobId}`);
                            if (!qItem.session && existingJob && existingJob.previewId) {
                                qItem.session = getSession(existingJob.previewId);
                            }
                            bookQueue.enqueue(qItem);
                        } else {
                            try { fs.unlinkSync(qPath); } catch (_) {}
                        }
                    }
                } catch (qErr) {
                    console.warn(`⚠️ Error reading queue file ${f}:`, qErr.message);
                }
            }
        }

        // 2. Recover un-queued dangling jobs from job_*.json files
        for (const f of files) {
            if (f.startsWith('job_') && f.endsWith('.json')) {
                const jPath = path.join(booksFolder, f);
                try {
                    const job = JSON.parse(fs.readFileSync(jPath, 'utf8'));
                    // If job was in-flight within the last 60 minutes when server restarted and not already queued
                    if (job && (job.status === 'generating' || job.status === 'queued') && (now - (job.timestamp || 0)) < 60 * 60 * 1000) {
                        const alreadyInQueue = bookQueue.queue.some(q => q.jobId === job.id);
                        if (!alreadyInQueue) {
                            console.log(`🔄 [SELF-HEALING] Interrupted job detected: ${job.id}. Checking session for auto-resume...`);
                            const session = job.previewId ? getSession(job.previewId) : null;
                            if (session) {
                                console.log(`🔄 [SELF-HEALING] Enqueuing resumed book fulfillment for ${session.childName} (${job.id})...`);
                                bookQueue.enqueue({
                                    jobId: job.id,
                                    session,
                                    bookLength: job.bookLength,
                                    parentEmail: job.email,
                                    protocol: 'https',
                                    host: process.env.RENDER_EXTERNAL_HOSTNAME || 'storybooks.twinkletaleai.com'
                                });
                            } else if (razorpay && job.paymentId && process.env.AUTO_REFUND_ON_FAILURE !== 'false') {
                                // If session cannot be recovered, execute fail-safe automatic refund immediately
                                console.warn(`💸 [SELF-HEALING] Session unavailable for ${job.id}. Processing automatic protection refund...`);
                                try {
                                    const ref = await razorpay.payments.refund(job.paymentId, {
                                        amount: job.amountSubunits || job.amountPaise || 19900,
                                        notes: { reason: "Server restart recovery refund", jobId: job.id }
                                    });
                                    job.status = 'failed';
                                    job.refundId = ref.id;
                                    job.refundStatus = 'initiated';
                                    job.error = 'Order interrupted during system restart — 100% refund initiated';
                                    saveJob(job.id, job);
                                    console.log(`✅ [SELF-HEALING] Refund initiated: ${ref.id}`);
                                } catch (rErr) {
                                    console.error(`⚠️ [SELF-HEALING] Refund attempt error:`, rErr.message);
                                }
                            }
                        }
                    }
                } catch (_) {}
            }
        }

        // 3. Supabase cloud recovery for interrupted jobs across container recreations
        if (supabase) {
            try {
                const { data: metaFiles } = await supabase.storage.from('storybooks').list('metadata', { limit: 50 });
                if (metaFiles && metaFiles.length > 0) {
                    for (const mf of metaFiles) {
                        if (mf.name.startsWith('job_') && mf.name.endsWith('.json')) {
                            const jobId = mf.name.replace(/^job_/, '').replace(/\.json$/, '');
                            const job = await getJobAsync(jobId);
                            if (job && (job.status === 'generating' || job.status === 'queued') && (now - (job.timestamp || 0)) < 60 * 60 * 1000) {
                                const alreadyInQueue = bookQueue.queue.some(q => q.jobId === job.id);
                                if (!alreadyInQueue) {
                                    console.log(`🔄 [SUPABASE HEALING] Recovered interrupted job ${job.id} from cloud! Checking session...`);
                                    const session = job.previewId ? (await getSessionAsync(job.previewId)) : null;
                                    if (session) {
                                        bookQueue.enqueue({
                                            jobId: job.id,
                                            session,
                                            bookLength: job.bookLength,
                                            parentEmail: job.email,
                                            protocol: 'https',
                                            host: process.env.RENDER_EXTERNAL_HOSTNAME || 'storybooks.twinkletaleai.com'
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (supRecErr) {
                console.warn('⚠️ [SUPABASE HEALING] Cloud recovery notice:', supRecErr.message);
            }
        }
    } catch (e) {
        console.warn('⚠️ Startup job recovery notice:', e.message);
    }
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 TwinkleTale Server running on port ${PORT}`);
        setTimeout(() => {
            recoverDanglingJobs();
        }, 4000);
    });
}

module.exports = {
    app,
    bookQueue,
    BookGenerationQueue,
    saveJob,
    getJob,
    getJobAsync,
    getSession,
    getSessionAsync,
    uploadToStorage,
    ensureSupabaseBucket,
    assembleFullBookAsync,
    recoverDanglingJobs
};