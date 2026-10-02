/**
 * Deep diagnostic test mocking replicate and executing assembleFullBookAsync end-to-end
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const axios = require('axios');

// Mock replicate before requiring server.js
const Replicate = require('replicate');
let replicateRunMock = async (model, params) => {
    console.log(`[MOCK REPLICATE] model=${model}`);
    return ['https://example.com/test-art.png'];
};

Replicate.prototype.run = function(model, params) {
    return replicateRunMock(model, params);
};

const { assembleFullBookAsync, saveJob, getJob } = require('../server');

async function testAssemble() {
    console.log('--- STARTING ASSEMBLE FULL BOOK TEST ---');
    const jobId = 'diag_job_' + Date.now();
    saveJob(jobId, { id: jobId, timestamp: Date.now() });

    // Generate a valid 3:4 test image buffer (with texture so it exceeds 5000 bytes)
    const testArtBuf = await sharp({
        create: {
            width: 768,
            height: 1024,
            channels: 3,
            background: { r: 120, g: 180, b: 240 }
        }
    }).composite([{
        input: Buffer.from('<svg width="768" height="1024"><text x="100" y="500" font-size="50">TEST IMAGE</text></svg>'),
        top: 0,
        left: 0
    }]).png().toBuffer();

    console.log(`Test Art Buffer size: ${testArtBuf.length} bytes`);

    // Mock axios.get
    const originalGet = axios.get;
    axios.get = async function(url, options) {
        console.log(`[MOCK AXIOS GET] url=${url}`);
        return { data: testArtBuf };
    };

    // Session matching the user's test order "Mia"
    const session = {
        previewId: 'diag_prev_' + Date.now(),
        childName: 'Mia',
        gender: 'girl',
        age: 5,
        theme: 'Magical Forest',
        language: 'English',
        email: 'test@example.com',
        photoData: 'data:image/png;base64,' + testArtBuf.toString('base64'),
        coverBuffer: testArtBuf,
        coverIsComposited: true,
        attributes: {
            hasGlasses: false,
            hasHeadwear: false,
            skinTone: 'fair'
        }
    };

    console.log('Running assembleFullBookAsync...');
    try {
        await assembleFullBookAsync(jobId, session, '12 pages', 'test@example.com', 'http', 'localhost:3000');
        console.log('✅ assembleFullBookAsync succeeded!');
        const job = getJob(jobId);
        console.log('Job status:', job.status, 'File:', job.fileName);

        // Verify PDF file on disk
        const pdfPath = path.join(__dirname, '..', 'books', job.fileName);
        assert.ok(fs.existsSync(pdfPath), `PDF file should exist at ${pdfPath}`);
        const { PDFDocument } = require('pdf-lib');
        const pdfBytes = fs.readFileSync(pdfPath);
        const doc = await PDFDocument.load(pdfBytes);
        const pages = doc.getPages();
        console.log(`Verifying ${pages.length} pages in PDF...`);
        assert.strictEqual(pages.length, 12, 'Page count must be 12');
        for (let i = 0; i < pages.length; i++) {
            const { width, height } = pages[i].getSize();
            console.log(`Page ${i + 1}: ${width} x ${height} pt`);
            assert.strictEqual(width, 612, `Page ${i + 1} width must be 612 pt (8.5")`);
            assert.strictEqual(height, 612, `Page ${i + 1} height must be 612 pt (8.5")`);
        }
        console.log('🎉 ALL 12 PAGES VERIFIED AT EXACT 612x612 pt (8.5" x 8.5" Square)!');
        process.exit(0);
    } catch (err) {
        console.error('❌ assembleFullBookAsync threw error:', err);
        throw err;
    } finally {
        axios.get = originalGet;
    }
}

testAssemble().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
