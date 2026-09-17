const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

// Import tested compilation engine and cloud helpers from server.js (server.js remains untouched)
const {
    assembleFullBookAsync,
    uploadToStorage,
    ensureSupabaseBucket,
    getJobAsync,
    saveJob,
    getJob
} = require('./server');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PORT = process.env.PORT || 8080;
const ENGINE_SECRET_TOKEN = process.env.ENGINE_SECRET_TOKEN || '';

// Security middleware for protected engine endpoints
function verifyEngineAuth(req, res, next) {
    if (!ENGINE_SECRET_TOKEN) return next(); // If no token configured in sandbox, allow testing
    const token = req.headers['x-engine-token'] || req.query.token;
    if (token !== ENGINE_SECRET_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized engine dispatch request' });
    }
    next();
}

// 1. Root & Health Check
app.get('/', (req, res) => {
    res.json({
        service: 'TwinkleTale Cloud Run Serverless Engine',
        version: '1.0.0',
        status: 'online',
        port: PORT,
        uptime: `${Math.floor(process.uptime())}s`
    });
});

app.get('/health', async (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        service: 'storybook-engine',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        memory: {
            heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
            heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1),
            rssMB: (mem.rss / 1024 / 1024).toFixed(1)
        }
    });
});

// 2. Production Contract: Asynchronous Book Assembly Dispatch
app.post('/api/assemble-book', verifyEngineAuth, async (req, res) => {
    const { jobId, session, bookLength, parentEmail, protocol, host } = req.body;
    if (!jobId || !session) {
        return res.status(400).json({ success: false, error: 'Missing jobId or session payload' });
    }

    console.log(`⚡ [CLOUD RUN ENGINE] Received assemble request for Job: ${jobId} (${session.childName}, ${bookLength || '12 pages'})`);

    // In Serverless Cloud Run, respond immediately with 202 Accepted so caller is never blocked
    res.status(202).json({
        success: true,
        message: 'Job accepted by Cloud Run engine worker',
        jobId,
        statusUrl: `/api/download/${jobId}`
    });

    try {
        await assembleFullBookAsync(
            jobId,
            session,
            bookLength || '12 pages',
            parentEmail || session.email,
            protocol || 'https',
            host || req.get('host')
        );
        console.log(`🎉 [CLOUD RUN ENGINE] Job ${jobId} successfully assembled and uploaded to permanent storage!`);
    } catch (err) {
        console.error(`❌ [CLOUD RUN ENGINE] Job ${jobId} compilation error:`, err.message);
    }
});

// 3. Sandbox / Quality Test Endpoint: Generate a Full Book Directly on Cloud Run
app.post('/api/test-generate-book', async (req, res) => {
    try {
        const {
            childName = 'Leo',
            theme = 'Trains & Tracks',
            gender = 'boy',
            age = 5,
            language = 'English',
            bookLength = '12 pages',
            dedication = 'With love from TwinkleTale',
            email = 'test@twinkletaleai.com',
            photoData = null
        } = req.body;

        const jobId = `job_cr_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        console.log(`🧪 [CLOUD RUN TEST] Starting test generation for ${childName} | Theme: ${theme} | Length: ${bookLength}`);

        // Construct mock session
        const mockSession = {
            previewId: `prev_cr_${Date.now()}`,
            childName,
            gender,
            age,
            theme,
            language,
            dedication,
            email,
            photoData,
            attributes: { headwear: 'none', glasses: 'none', skinTone: 'natural' },
            charAnchor: `a cute ${age}-year-old ${gender} named ${childName}`,
            pronoun: gender === 'girl' ? 'her' : 'his',
            subjectPronoun: gender === 'girl' ? 'she' : 'he',
            title: `${childName}'s ${theme} Adventure`,
            bookTitle: `${childName}'s ${theme} Adventure`,
            scenesData: []
        };

        saveJob(jobId, {
            id: jobId,
            status: 'generating',
            progress: 10,
            step: 'Cloud Run worker compiling storybook...',
            timestamp: Date.now()
        });

        // Run full assembly
        await assembleFullBookAsync(
            jobId,
            mockSession,
            bookLength,
            email,
            req.protocol,
            req.get('host')
        );

        const completedJob = await getJobAsync(jobId);
        return res.json({
            success: true,
            message: 'Book generated successfully on Google Cloud Run!',
            jobId,
            fileName: completedJob?.fileName,
            pdfUrl: completedJob?.pdfUrl,
            directPdfUrl: completedJob?.directPdfUrl,
            supabaseUrl: completedJob?.supabaseUrl
        });
    } catch (err) {
        console.error('❌ [CLOUD RUN TEST] Error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Download Route on Cloud Run
app.get('/api/download/:jobId', async (req, res) => {
    const job = await getJobAsync(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found on cloud engine' });
    }
    if (job.status !== 'completed') {
        return res.json({ status: job.status, progress: job.progress, step: job.step });
    }
    if (job.supabaseUrl) {
        return res.redirect(job.supabaseUrl);
    }
    if (job.directPdfUrl) {
        return res.redirect(job.directPdfUrl);
    }
    res.json(job);
});

// Start listening if run directly
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 TwinkleTale Serverless Cloud Run Engine listening on port ${PORT}`);
        ensureSupabaseBucket();
    });
}

module.exports = app;
