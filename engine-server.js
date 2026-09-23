const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// Global diagnostic & safety handlers
process.on('uncaughtException', (err) => {
    console.error('❌ [FATAL UNCAUGHT EXCEPTION]:', err.stack || err.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ [FATAL UNHANDLED REJECTION]:', reason);
});

// Load environment variables
require('dotenv').config();
process.env.IS_CLOUD_RUN = 'true';

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
} else {
    process.env.SENDER_EMAIL = 'support@twinkletaleai.com';
}

// Ensure WebSocket constructor is available for Supabase RealtimeClient
if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = class WebSocketFallback {
        constructor() {
            this.readyState = 3; // CLOSED
        }
        addEventListener() {}
        removeEventListener() {}
        send() {}
        close() {}
    };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PORT = process.env.PORT || 8080;
const ENGINE_SECRET_TOKEN = process.env.ENGINE_SECRET_TOKEN || '';

// 1. Root & Health Check (mounted immediately for instant Cloud Run startup probes)
app.get('/', (req, res) => {
    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html')) {
        return res.json({
            service: 'TwinkleTale Cloud Run Serverless Engine',
            version: '1.0.0',
            status: 'online',
            port: PORT,
            uptime: `${Math.floor(process.uptime())}s`
        });
    }
    res.sendFile(path.join(__dirname, 'index.html'));
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

// Live diagnostic endpoint for Brevo senders and account status
app.get('/api/brevo-diagnostic', async (req, res) => {
    const brevoKey = String(process.env.BREVO_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!brevoKey) {
        return res.json({ success: false, error: 'BREVO_API_KEY is not set' });
    }
    try {
        const [sendersRes, acctRes] = await Promise.allSettled([
            axios.get('https://api.brevo.com/v3/senders', {
                headers: { 'api-key': brevoKey },
                timeout: 8000
            }),
            axios.get('https://api.brevo.com/v3/account', {
                headers: { 'api-key': brevoKey },
                timeout: 8000
            })
        ]);
        res.json({
            success: true,
            configuredSenderEmail: process.env.SENDER_EMAIL || null,
            brevoSenders: sendersRes.status === 'fulfilled' ? sendersRes.value.data : { error: sendersRes.reason?.response?.data || sendersRes.reason?.message },
            brevoAccount: acctRes.status === 'fulfilled' ? acctRes.value.data : { error: acctRes.reason?.response?.data || acctRes.reason?.message }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Live test email sending endpoint
app.get('/api/test-email-live', async (req, res) => {
    const brevoKey = String(process.env.BREVO_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    const to = req.query.to || 'ashishagrawal343@gmail.com';
    const sender = req.query.sender || process.env.SENDER_EMAIL || 'support@twinkletaleai.com';
    if (!brevoKey) {
        return res.json({ success: false, error: 'BREVO_API_KEY not set' });
    }
    try {
        const response = await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: 'TwinkleTale', email: sender },
            to: [{ email: to }],
            subject: 'TwinkleTale Diagnostic Email',
            htmlContent: `<p>This is a live test email sent to ${to} via sender ${sender}.</p>`
        }, {
            headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
            timeout: 8000
        });
        res.json({ success: true, to, senderUsed: sender, result: response.data });
    } catch (err) {
        res.json({
            success: false,
            to,
            senderAttempted: sender,
            error: err.message,
            brevoResponse: err.response?.data || null,
            status: err.response?.status || null
        });
    }
});

// Route alias: map /api/generate-preview to /api/create-preview for universal compatibility
app.post('/api/generate-preview', (req, res, next) => {
    req.url = '/api/create-preview';
    if (serverModule && serverModule.app) {
        return serverModule.app.handle(req, res, next);
    }
    next();
});

// Mount full storefront sub-app (serves /, /special, /us, static assets, and preview/order endpoints)
if (serverModule && serverModule.app) {
    app.use(serverModule.app);
    console.log('🌐 Storefront sub-app mounted successfully: /, /special, /us active on Cloud Run');
}

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

    console.log(`⚡ [CLOUD RUN ENGINE] Active compilation started for Job: ${jobId} (${session.childName}, ${bookLength || '12 pages'})`);

    // Ensure job is tracked in memory on Cloud Run
    if (saveJob) {
        saveJob(jobId, {
            id: jobId,
            status: 'generating',
            progress: 10,
            step: 'Cloud Run worker compiling storybook...',
            timestamp: Date.now()
        });
    }

    try {
        // Normalize any serialized buffers in session
        if (session.coverBuffer) {
            if (Buffer.isBuffer(session.coverBuffer)) {
                // already buffer
            } else if (session.coverBuffer.type === 'Buffer' && Array.isArray(session.coverBuffer.data)) {
                session.coverBuffer = Buffer.from(session.coverBuffer.data);
            } else if (typeof session.coverBuffer === 'string' && session.coverBuffer.startsWith('data:')) {
                session.coverBuffer = Buffer.from(session.coverBuffer.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            }
        }
        if (session.bgBuffer && !Buffer.isBuffer(session.bgBuffer) && session.bgBuffer.type === 'Buffer' && Array.isArray(session.bgBuffer.data)) {
            session.bgBuffer = Buffer.from(session.bgBuffer.data);
        }
        if (session.vigBuffer && !Buffer.isBuffer(session.vigBuffer) && session.vigBuffer.type === 'Buffer' && Array.isArray(session.vigBuffer.data)) {
            session.vigBuffer = Buffer.from(session.vigBuffer.data);
        }

        // CRITICAL CLOUD RUN ARCHITECTURAL FIX:
        // Cloud Run throttles container CPU to near-zero as soon as an HTTP response is returned.
        // Holding this HTTP request open ensures Cloud Run allocates 100% CPU capacity for the entire generation!
        await assembleFullBookAsync(
            jobId,
            session,
            bookLength || '12 pages',
            parentEmail || session.email,
            protocol || 'https',
            host || req.get('host')
        );

        const completedJob = getJobAsync ? await getJobAsync(jobId) : (getJob ? getJob(jobId) : null);
        console.log(`🎉 [CLOUD RUN ENGINE] Job ${jobId} successfully assembled and uploaded to permanent storage!`);

        return res.json({
            success: true,
            jobId,
            status: 'completed',
            progress: 100,
            fileName: completedJob?.fileName,
            pdfUrl: completedJob?.pdfUrl,
            directPdfUrl: completedJob?.directPdfUrl,
            supabaseUrl: completedJob?.supabaseUrl,
            emailed: completedJob?.emailed || false
        });
    } catch (err) {
        console.error(`❌ [CLOUD RUN ENGINE] Job ${jobId} compilation error:`, err.message);
        return res.status(500).json({ success: false, error: err.message });
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
    const fileName = job.fileName || `twinkletale_${job.id}.pdf`;
    const localFile = path.join(__dirname, 'books', fileName);
    if (fs.existsSync(localFile) && fs.statSync(localFile).size > 0) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        return res.sendFile(localFile);
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
