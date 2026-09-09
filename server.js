require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Replicate = require('replicate');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
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

// Fit image to full page without distortion (center-crop)
function coverFit(img, pw, ph) {
    const ir = img.width / img.height, pr = pw / ph;
    let w, h;
    if (ir > pr) { h = ph; w = ph * ir; } else { w = pw; h = pw / ir; }
    return { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h };
}

// Face-consistent generation when photo exists, fallback otherwise
async function generateImage(prompt, photoData) {
    if (photoData) {
        try {
            const out = await replicate.run("black-forest-labs/flux-kontext-pro", {
                input: { input_image: photoData, prompt: prompt, output_format: "png" }
            });
            return Array.isArray(out) ? out[0] : out;
        } catch (e) {
            console.log("    (face model failed, falling back to standard model)");
        }
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

app.post('/api/create-book', async (req, res) => {
    try {
        const { childName, theme, photoData } = req.body;
        console.log(`Starting book for ${childName} | theme: ${theme} | photo: ${photoData ? 'yes' : 'no'}`);

        // 1. STORY
        console.log("Step 1: Writing story...");
        const storyResponse = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'You are a children\'s book author. Output ONLY a valid JSON array of 4 objects. No markdown, no extra text. Each object must have "page_text" (40-60 words of warm, simple story language for kids) and "image_prompt" (one sentence describing a single vivid scene in 3D Pixar storybook style featuring the child protagonist).' },
                { role: 'user', content: `Write a 4-scene story about a child named ${childName} going on a ${theme} adventure.` }
            ]
        }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` } });

        let storyText = storyResponse.data.choices[0].message.content;
        storyText = storyText.replace(/```json/g, '').replace(/```/g, '').trim();
        const pages = JSON.parse(storyText);
        console.log("✅ Story generated!");

        // 2. BOOK BUILD
        console.log("Step 2: Building cover + image/text spreads...");
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // ---- COVER PAGE ----
        console.log("  → Generating cover...");
        const coverPrompt = photoData
            ? `Children's picture book cover starring the exact same child from the reference photo as a cute 3D Pixar style character, ${theme} adventure theme, magical vibrant background, professional storybook cover composition, no text, no letters, no words`
            : `Children's picture book cover with a cute 3D Pixar style child protagonist, ${theme} adventure theme, magical vibrant background, professional storybook cover composition, no text, no letters, no words`;
        const coverImg = await fetchImage(pdfDoc, await generateImage(coverPrompt, photoData));

        const coverPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        coverPage.drawImage(coverImg, coverFit(coverImg, PAGE_W, PAGE_H));
        coverPage.drawRectangle({ x: 0, y: 600, width: PAGE_W, height: 200, color: rgb(0, 0, 0), opacity: 0.45 });
        coverPage.drawText(`${childName}'s`, { x: 40, y: 730, size: 30, font: bold, color: rgb(1, 0.85, 0.4) });
        coverPage.drawText(`${theme} Adventure`, { x: 40, y: 660, size: 34, font: bold, color: rgb(1, 1, 1), maxWidth: 520, lineHeight: 40 });
        coverPage.drawText('A Personalized Storybook', { x: 40, y: 622, size: 16, font: font, color: rgb(1, 1, 1) });

        // ---- SCENES: full image page + facing text page ----
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            console.log(`  → Scene ${i + 1}: generating image...`);
            const scenePrompt = photoData
                ? `3D Pixar style children's book illustration with the exact same child face as the reference photo: ${page.image_prompt}, vibrant, magical, high quality, no text, no letters`
                : `3D Pixar style children's book illustration: ${page.image_prompt}, vibrant, magical, high quality, no text, no letters`;
            const pdfImage = await fetchImage(pdfDoc, await generateImage(scenePrompt, photoData));

            // Full-bleed image page
            const imgPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            imgPage.drawImage(pdfImage, coverFit(pdfImage, PAGE_W, PAGE_H));

            // Facing text page
            const textPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
            textPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1, 0.97, 0.93) });
            textPage.drawRectangle({ x: 40, y: 40, width: PAGE_W - 80, height: PAGE_H - 80, borderColor: rgb(0.95, 0.5, 0.45), borderWidth: 3 });
            textPage.drawText(`Scene ${i + 1}`, { x: 70, y: 700, size: 14, font: bold, color: rgb(0.95, 0.45, 0.4) });
            textPage.drawText(page.page_text, { x: 70, y: 620, size: 19, font: font, color: rgb(0.25, 0.2, 0.2), maxWidth: 460, lineHeight: 32 });
            textPage.drawText(`${childName}'s ${theme} Adventure`, { x: 70, y: 70, size: 11, font: font, color: rgb(0.6, 0.55, 0.55) });

            if (i < pages.length - 1) {
                console.log("  ⏳ Waiting 12 seconds...");
                await new Promise(resolve => setTimeout(resolve, 12000));
            }
        }

        // 3. SAVE & SERVE
        console.log("Step 3: Saving PDF...");
        const pdfBytes = await pdfDoc.save();
        const safeName = String(childName).replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `book_${safeName}_${Date.now()}.pdf`;
        fs.writeFileSync(path.join(booksFolder, fileName), pdfBytes);

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