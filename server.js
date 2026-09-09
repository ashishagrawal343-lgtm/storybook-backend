require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Replicate = require('replicate');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// --- APP SETUP ---
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Create a 'books' folder to store PDFs locally
const booksFolder = path.join(__dirname, 'books');
if (!fs.existsSync(booksFolder)) {
    fs.mkdirSync(booksFolder);
}

// --- THE MAGIC ENDPOINT ---
app.post('/api/create-book', async (req, res) => {
    try {
        const { childName, theme, photoUrl } = req.body;
        console.log(`Starting book for ${childName} with theme: ${theme}`);

        // 1. GENERATE STORY (DeepSeek)
        console.log("Step 1: Writing story...");
        const storyResponse = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                { 
                    role: 'system', 
                    content: 'You are a children\'s book author. Output ONLY a valid JSON array of 4 objects. No markdown, no extra text. Each object must have "page_text" (max 30 words, simple for kids) and "image_prompt" (describing the scene in 3D Pixar storybook style, featuring a cute child matching the reference photo).' 
                },
                { 
                    role: 'user', 
                    content: `Write a 4-page story about a child named ${childName} going on a ${theme} adventure.` 
                }
            ]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            }
        });

        let storyText = storyResponse.data.choices[0].message.content;
        storyText = storyText.replace(/```json/g, '').replace(/```/g, '').trim();
        const pages = JSON.parse(storyText);

        // 2. GENERATE IMAGES & BUILD PDF
        console.log("Step 2: Generating images and building PDF...");
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            console.log(`Generating image for page ${i + 1}...`);
            
            const imageOutput = await replicate.run("black-forest-labs/flux-1.1-pro", {
                input: {
                    prompt: `3D Pixar style children's book illustration, ${page.image_prompt}, vibrant, magical, high quality, cute`,
                    aspect_ratio: "1:1",
                    output_format: "png"
                }
            });
            
            const imageUrl = Array.isArray(imageOutput) ? imageOutput[0] : imageOutput;

            const newPage = pdfDoc.addPage([600, 800]);
            
            const imageBytes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            let pdfImage;
            try {
                pdfImage = await pdfDoc.embedPng(imageBytes.data);
            } catch (e) {
                pdfImage = await pdfDoc.embedJpg(imageBytes.data);
            }
            
            newPage.drawImage(pdfImage, { x: 50, y: 350, width: 500, height: 400 });

            newPage.drawText(`${childName}'s ${theme} Adventure - Page ${i + 1}`, { 
                x: 50, y: 750, size: 24, font, color: rgb(0.2, 0.4, 0.8) 
            });
            newPage.drawText(page.page_text, { 
                x: 50, y: 280, size: 18, font, color: rgb(0, 0, 0), maxWidth: 500 
            });

            // SAFETY DELAY: Wait 12 seconds to avoid Replicate's rate limit
            if (i < pages.length - 1) {
                console.log("⏳ Waiting 12 seconds to respect API rate limits...");
                await new Promise(resolve => setTimeout(resolve, 12000));
            }
        }

        // 3. SAVE PDF LOCALLY (No Firebase required!)
        console.log("Step 3: Saving PDF locally...");
        const pdfBytes = await pdfDoc.save();
        const fileName = `book_${childName}_${Date.now()}.pdf`;
        const filePath = path.join(booksFolder, fileName);
        
        fs.writeFileSync(filePath, pdfBytes);
        
        // Create a public URL that serves the file from your local server
        const publicUrl = `http://localhost:${process.env.PORT || 3000}/books/${fileName}`;

        res.json({ success: true, pdfUrl: publicUrl });

    } catch (error) {
        console.error("Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve the books folder as static files
app.use('/books', express.static(path.join(__dirname, 'books')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));