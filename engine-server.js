const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Global diagnostic & safety handlers
process.on('uncaughtException', (err) => {
    console.error('❌ [FATAL UNCAUGHT EXCEPTION]:', err.stack || err.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ [FATAL UNHANDLED REJECTION]:', reason);
});

// Load environment variables
require('dotenv').config();

// Pre-sanitize cloud environment variables before importing compilation helpers
if (process.env.SUPABASE_URL) {
    let cleanUrl = String(process.env.SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '');
    if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) {
        cleanUrl = `https://${cleanUrl}`;
    }
    process.env.SUPABASE_URL = cleanUrl;
}
if (process.env.SUPABASE_SERVICE_KEY) {
    process.env.SUPABASE_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_KEY || '').trim().replace(/^["']|["']$/g, '');
}
if (process.env.REPLICATE_API_TOKEN) {
    process.env.REPLICATE_API_TOKEN = String(process.env.REPLICATE_API_TOKEN || '').trim().replace(/^["']|["']$/g, '');
}
if (process.env.DEEPSEEK_API_KEY) {
    process.env.DEEPSEEK_API_KEY = String(process.env.DEEPSEEK_API_KEY || '').trim().replace(/^["']|["']$/g, '');
}
if (process.env.BREVO_API_KEY) {
    process.env.BREVO_API_KEY = String(process.env.BREVO_API_KEY || '').trim().replace(/^["']|["']$/g, '');
}
if (process.env.SENDER_EMAIL) {
    process.env.SENDER_EMAIL = String(process.env.SENDER_EMAIL || '').trim().replace(/^["']|["']$/g, '');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PORT = process.env.PORT || 8080;
const ENGINE_SECRET_TOKEN = process.env.ENGINE_SECRET_TOKEN || '';

// 1. Root & Health Check (mounted immediately for instant Cloud Run startup probes)
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

// Immediately bind to port so Cloud Run startup probe succeeds in <50ms
let server = null;
if (require.main === module) {
    server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 TwinkleTale Serverless Cloud Run Engine listening on port ${PORT}`);
    });
    server.on('error', (err) => {
        console.error('❌ [FATAL LISTEN ERROR]:', err);
    });
}

// Safely load core compilation engine from server.js (server.js remains untouched)
let serverModule = {};
let serverLoadError = null;
try {
    serverModule = require('./server');
    if (typeof serverModule.ensureSupabaseBucket === 'function') {
        serverModule.ensureSupabaseBucket();
    }
} catch (loadErr) {
    serverLoadError = {
        message: loadErr.message,
        stack: loadErr.stack,
        code: loadErr.code
    };
    console.error('❌ [ENGINE LOADER ERROR] Failed to load server compilation module:', loadErr.stack || loadErr.message || loadErr);
}

const {
    assembleFullBookAsync,
    uploadToStorage,
    ensureSupabaseBucket,
    getJobAsync,
    saveJob,
    getJob
} = serverModule;

// Diagnostic inspection route to expose module readiness and environment health
app.get('/api/engine-debug', (req, res) => {
    res.json({
        engineReady: !!assembleFullBookAsync,
        serverLoadError: serverLoadError,
        envVars: {
            hasReplicate: !!process.env.REPLICATE_API_TOKEN,
            hasSupabaseUrl: !!process.env.SUPABASE_URL,
            supabaseUrlSample: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 15) + '...' : null,
            hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
            hasDeepseek: !!process.env.DEEPSEEK_API_KEY,
            hasBrevo: !!process.env.BREVO_API_KEY,
            hasSenderEmail: !!process.env.SENDER_EMAIL,
            port: process.env.PORT,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
        }
    });
});

// Security middleware for protected engine endpoints
function verifyEngineAuth(req, res, next) {
    if (!ENGINE_SECRET_TOKEN) return next();
    const token = req.headers['x-engine-token'] || req.query.token;
    if (token !== ENGINE_SECRET_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized engine dispatch request' });
    }
    next();
}

// 2. Production Contract: Asynchronous Book Assembly Dispatch
app.post('/api/assemble-book', verifyEngineAuth, async (req, res) => {
    const { jobId, session, bookLength, parentEmail, protocol, host } = req.body;
    if (!jobId || !session) {
        return res.status(400).json({ success: false, error: 'Missing jobId or session payload' });
    }

    if (!assembleFullBookAsync) {
        return res.status(503).json({ success: false, error: 'Engine compilation worker not initialized' });
    }

    console.log(`⚡ [CLOUD RUN ENGINE] Received assemble request for Job: ${jobId} (${session.childName}, ${bookLength || '12 pages'})`);

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
        if (!assembleFullBookAsync || !saveJob || !getJobAsync) {
            return res.status(503).json({
                success: false,
                error: 'Compilation engine not ready',
                details: serverLoadError
            });
        }

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
    if (!getJobAsync) {
        return res.status(503).json({ error: 'Engine not ready' });
    }
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

module.exports = app;
