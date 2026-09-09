require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Replicate = require('replicate');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '15mb' }));
app.use(cors());

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

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
                sender: { name: 'Storybook Studio', email: process.env.SENDER_EMAIL },
                to: [{ email: to }],
                subject: subject,
                html: html || `<p>${text}</p>`
            }, { headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' } });
        }
    };
    console.log('📧 Email delivery: ON (Brevo HTTPS)');
} else {
    console.log('⚠️ Brevo not configured — link-only delivery');
}

const booksFolder = path.join(__dirname, 'books');
if (!fs.existsSync(booksFolder)) fs.mkdirSync(booksFolder);

const PAGE_W = 600, PAGE_H = 800;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STYLE = 'hand-painted children\'s storybook illustration, soft gouache texture, warm pastel palette, gentle storybook lighting, cohesive series style, no text, no letters, no watermark: ';
const PACING = 10000;

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
    if (arr.length >= 3) return res.status(429).json({ success: false, error: 'Too many books at once. Please wait a minute and try again.' });
    arr.push(now); hits.set(ip, arr);
    next();
}

function themeKit(base) {
    const b = base.toLowerCase();
    if (b.includes('space')) return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.20, 0.30), flatWord: 'solid flat deep indigo navy', motifs: 'tiny stars, crescent moons, little silver rockets and planets' };
    if (b.includes('animal')) return { cover: rgb(0.10, 0.30, 0.24), accent: rgb(0.95, 0.80, 0.45), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.24, 0.20), flatWord: 'solid flat deep forest green', motifs: 'friendly forest animals, oak leaves, acorns and wildflowers' };
    if (b.includes('princess')) return { cover: rgb(0.55, 0.16, 0.35), accent: rgb(0.99, 0.85, 0.60), textBg: rgb(0.99, 0.96, 0.94), ink: rgb(0.32, 0.17, 0.24), flatWord: 'solid flat deep rose plum', motifs: 'roses, tiny golden crowns and silk ribbons' };
    if (b.includes('super')) return { cover: rgb(0.45, 0.08, 0.12), accent: rgb(0.98, 0.75, 0.20), textBg: rgb(0.985, 0.96, 0.92), ink: rgb(0.30, 0.16, 0.14), flatWord: 'solid flat deep crimson', motifs: 'bright stars, hero shields and lightning bolts' };
    return { cover: rgb(0.05, 0.10, 0.32), accent: rgb(0.96, 0.78, 0.26), textBg: rgb(0.985, 0.965, 0.92), ink: rgb(0.20, 0.20, 0.30), flatWord: 'solid flat deep indigo navy', motifs: 'flowers, leaves, ribbons and golden bells' };
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
function drawCentered(page, text, y, size, font, color, opacity) {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (PAGE_W - w) / 2, y, size, font, color, opacity: opacity === undefined ? 1 : opacity });
}
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
        const { childName, theme, photoData, bookLength, dedication, email } = req.body;
        const base = String(theme || 'Adventure').split(' (')[0];
        const scenes = (String(bookLength).toLowerCase().startsWith('long')) ? 8 : 4;
        const pal = themeKit(base);
        const title = themeTitle(base);
        assertZones();
        console.log(`📘 Book v6 | ${childName} | ${base} | scenes=${scenes} | photo=${photoData ? 'yes' : 'no'} | email=${email ? 'yes' : 'no'}`);

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
            scene_title: String(p.scene_title || 'Scene').slice(0, 60),
            page_text: String(p.page_text || '').slice(0, 700),
            image_prompt: String(p.image_prompt || 'a magical storybook scene').slice(0, 500)
        }));
        console.log("✅ Story validated!");

        console.log("Step 2: Painting locked cover, frame & scenes...");
        const pdfDoc = await PDFDocument.create();
        pdfDoc.setTitle(`${childName}'s ${title}`);
        pdfDoc.setAuthor('Storybook Studio');
        pdfDoc.setSubject(`A personalized storybook for ${childName}`);
        pdfDoc.setCreator('Storybook Studio AI');

        const serif = await pdfDoc.embedFont('Times-Roman');
        const serifB = await pdfDoc.embedFont('Times-Bold');
        const serifI = await pdfDoc.embedFont('Times-Italic');
        const serifBI = await pdfDoc.embedFont('Times-BoldItalic');
        if (!serif || !serifB || !serifI || !serifBI) throw new Error('Font embedding failed');

        console.log("  → Cover background...");
        const bgPrompt = STYLE + `ornate storybook cover BACKGROUND only: elaborate golden-cream vine and leaf border with small vignettes of ${pal.motifs} confined strictly to the outer fifteen percent edges; two gentle painted flourish arches of tiny leaves and stars, one arching across the top center framing an empty name plaque area, and one arching across the lower middle framing an empty title plaque area; the rest of the inner field is ${pal.flatWord}, flat and empty except a few sparse tiny stars; absolutely no character, no person, no moon, no text, no letters anywhere; rich painterly detail`;
        const bgImg = await withRetry('cover background', async () => fetchImage(pdfDoc, await generateImage(bgPrompt, null)));
        await sleep(PACING);

        console.log("  → Child medallion...");
        const vigPrompt = STYLE + `circular painted vignette portrait of ${photoData ? 'the exact same child from the reference photo' : 'a cute child'} as the storybook hero, head and shoulders, joyful expression, soft golden rim light, a few tiny ${pal.motifs} sparkles around the head, surrounded by ${pal.flatWord} background filling all four corners, vignette edges softly fading into that flat background`;
        const vigImg = await withRetry('child vignette', async () => fetchImage(pdfDoc, await generateImage(vigPrompt, photoData)));
        await sleep(PACING);

        console.log("  → Decorative page frame...");
        const framePrompt = STYLE + `decorative rectangular border frame for a children's book page, repeating hand-painted motifs of ${pal.motifs} woven with ribbons and leaves around all four edges, wide plain warm cream empty center occupying seventy percent of the page, soft pastel palette, gentle textures`;
        const frameImg = await withRetry('frame image', async () => fetchImage(pdfDoc, await generateImage(framePrompt, null)));
        await sleep(PACING);

        let pageNo = 0;

        const cover = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNo++;
        cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        cover.drawImage(bgImg, coverFit(bgImg, PAGE_W, PAGE_H));
        const d = Z.medal.r * 2;
        const fit = coverFit(vigImg, d, d);
        const dx = (Z.medal.cx - Z.medal.r) + fit.x;
        const dy2 = (Z.medal.cy - Z.medal.r) + fit.y;
        if (Math.abs((dx + fit.width / 2) - Z.medal.cx) > 2 || Math.abs((dy2 + fit.height / 2) - Z.medal.cy) > 2) throw new Error('Medallion placement guardrail failed');
        cover.drawImage(vigImg, { x: dx, y: dy2, width: fit.width, height: fit.height });
        cover.drawEllipse({ x: Z.medal.cx, y: Z.medal.cy, xScale: Z.medal.r + 5, yScale: Z.medal.r + 5, borderColor: pal.accent, borderWidth: 3.5 });
        cover.drawEllipse({ x: Z.medal.cx, y: Z.medal.cy, xScale: Z.medal.r + 11, yScale: Z.medal.r + 11, borderColor: pal.accent, borderWidth: 1.5, borderOpacity: 0.7 });
        drawFlowLine(cover, `${childName}'s`, 700, 44, serifBI, pal.accent, 2);
        let tSize = 40;
        let tLines = wrapText(title, serifB, tSize, 470);
        if (tLines.length > 3) { tSize = 34; tLines = wrapText(title, serifB, tSize, 470); }
        let ty = 292;
        for (const line of tLines) {
            drawFlowLine(cover, line, ty, tSize, serifB, rgb(0.99, 0.98, 0.94), 3);
            ty -= 46;
        }

        const ded = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNo++;
        ded.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.textBg });
        ded.drawImage(frameImg, coverFit(frameImg, PAGE_W, PAGE_H));
        ded.drawRectangle({ x: PAGE_W / 2 - 5, y: 596, width: 10, height: 10, color: pal.cover, rotate: degrees(45) });
        drawCentered(ded, `For ${childName},`, 520, 32, serifBI, pal.cover);
        const dedText = (dedication && dedication.trim()) ? dedication.trim() : 'may this little story remind you, every single night, just how hugely loved you are.';
        const dedLines = wrapText(dedText, serifI, 18, 380);
        let dy = 450 - ((450 - 210) - dedLines.length * 32) / 2;
        for (const line of dedLines) {
            drawCentered(ded, line, dy, 18, serifI, pal.ink);
            dy -= 32;
        }
        drawCentered(ded, `Printed just for you • ${new Date().getFullYear()}`, 130, 11, serif, pal.ink, 0.85);

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
            textPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, PAGE_H, color: pal.textBg });
            textPage.drawImage(frameImg, coverFit(frameImg, PAGE_W, PAGE_H));
            drawCentered(textPage, page.scene_title, 600, 26, serifB, pal.cover);
            textPage.drawRectangle({ x: PAGE_W / 2 - 4, y: 566, width: 8, height: 8, color: pal.cover, rotate: degrees(45) });
            const verseLines = wrapText(page.page_text, serif, 18, 400);
            let by = 520 - ((520 - 160) - verseLines.length * 32) / 2;
            for (const line of verseLines) {
                drawCentered(textPage, line, by, 18, serif, pal.ink);
                by -= 32;
            }
            drawCentered(textPage, String(pageNo), 112, 11, serif, pal.ink, 0.8);

            if (i < pages.length - 1) {
                console.log("  ⏳ 10s pacing...");
                await sleep(PACING);
            }
        }

        const back = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNo++;
        back.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: pal.cover });
        drawFrameVectors(back, pal);
        drawCentered(back, 'This book belongs to', 400, 16, serifI, rgb(0.99, 0.98, 0.94));
        drawCentered(back, `${childName}`, 350, 32, serifBI, pal.accent);
        drawCentered(back, `Crafted uniquely in ${new Date().getFullYear()} • A one-of-a-kind keepsake`, 140, 11, serif, pal.accent);

        // 3. SAVE: Supabase first (permanent), local fallback
        console.log("Step 3: Saving PDF...");
        const pdfBytes = await pdfDoc.save();
        const safeName = String(childName).replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `book_${safeName}_${Date.now()}.pdf`;
        let pdfUrl = null;

        if (supabase) {
            try {
                const up = await supabase.storage.from('storybooks').upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: false });
                if (up.error) throw new Error(up.error.message);
                pdfUrl = supabase.storage.from('storybooks').getPublicUrl(fileName).data.publicUrl;
                console.log("☁️ Saved permanently to Supabase");
            } catch (e) {
                console.log("⚠️ Supabase upload failed, using local fallback:", e.message);
                pdfUrl = null;
            }
        }
        if (!pdfUrl) {
            fs.writeFileSync(path.join(booksFolder, fileName), pdfBytes);
            pdfUrl = `${req.protocol}://${req.get('host')}/books/${fileName}`;
            console.log("💾 Saved locally (fallback)");
        }

        // 4. EMAIL (optional, never fails the book)
                let emailed = false;
        if (mailer && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            try {
                await mailer.sendMail({
                    from: `"Storybook Studio" <${process.env.GMAIL_USER}>`,
                    to: email,
                    subject: `${childName}'s Personalized Storybook is ready! 🎉`,
                    html: `<div style="font-family:Georgia,serif;padding:24px;background:#fdf8ef;border-radius:12px"><h2 style="color:#5a2a4d">📚 ${childName}'s ${title}</h2><p>Hello! Your personalized storybook is ready.</p><p><a href="${pdfUrl}" style="background:#28a745;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Download ${childName}'s Book</a></p><p style="color:#777;font-size:13px">This link never expires. Made with love by Storybook Studio.</p></div>`
                });
                                emailed = true;
                console.log("📧 Email sent to", email);
            } catch (e) {
                console.log("⚠️ Email failed (book still delivered via link):", e.message);
            }
        }

        console.log(`✅ Done in ${((Date.now() - t0) / 1000).toFixed(0)}s | ${pageNo} pages`);
                res.json({ success: true, pdfUrl: pdfUrl, emailed: emailed });
    } catch (error) {
        console.error("❌ ERROR:", error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/test-email', async (req, res) => {
    if (!process.env.EMAIL_TEST_TOKEN || req.query.token !== process.env.EMAIL_TEST_TOKEN) return res.status(403).json({ ok: false });
    if (!mailer) return res.json({ ok: false, error: 'mailer not configured' });
    try {
        await mailer.sendMail({ to: process.env.SENDER_EMAIL || process.env.GMAIL_USER, subject: 'Render email test', html: '<p>If you see this, email delivery works!</p>' });
        res.json({ ok: true });
    } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.use('/books', express.static(path.join(__dirname, 'books')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));