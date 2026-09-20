/**
 * TwinkleTale AI — Generation Manifest & AI Cost Auditor
 * Provides end-to-end observability, tracking every paid AI call,
 * model, latency, retry reason, and estimated operational cost per order.
 */

const fs = require('fs');
const path = require('path');

const MODEL_COSTS = {
    'black-forest-labs/flux-kontext-pro': 0.040,
    'black-forest-labs/flux-1.1-pro': 0.040,
    'black-forest-labs/flux-2-pro': 0.045,
    'google/nano-banana-pro': 0.030,
    'google/gemini-2.5-flash': 0.0005,
    'deepseek-chat': 0.0005,
    'nightmareai/real-esrgan': 0.005,
    'philz1337x/clarity-upscaler': 0.015
};

class OrderGenerationManifest {
    constructor(jobId, previewId = null) {
        this.jobId = jobId || `job_${Date.now()}`;
        this.previewId = previewId;
        this.pipelineVersion = process.env.CHARACTER_PIPELINE_VERSION || 'v2.0';
        this.startTime = Date.now();
        this.completedTime = null;

        this.characterMaster = null;
        this.characterSheet = null;
        this.cover = {
            generated: false,
            reusedAfterPayment: true,
            model: null,
            latencyMs: 0
        };

        this.pages = [];
        this.aiCalls = [];

        this.totalAiGenerationCalls = 0;
        this.totalUpscaleCalls = 0;
        this.estimatedAiCost = 0.00;
    }

    /**
     * Records a paid AI call with full auditing details
     */
    recordAiCall({
        stage,
        page = null,
        model,
        reason = 'initial_generation',
        attempt = 1,
        inputAssetId = null,
        outputAssetId = null,
        cached = false,
        latencyMs = 0,
        success = true
    }) {
        const unitCost = cached ? 0 : (MODEL_COSTS[model] || 0.040);
        const entry = {
            timestamp: Date.now(),
            stage,
            page,
            model,
            reason,
            attempt,
            inputAssetId,
            outputAssetId,
            cached,
            unitCost,
            latencyMs,
            success
        };

        this.aiCalls.push(entry);

        if (!cached) {
            this.estimatedAiCost += unitCost;
            if (stage === 'upscale') {
                this.totalUpscaleCalls++;
            } else {
                this.totalAiGenerationCalls++;
            }
        }

        console.log(`📊 [AI_COST_AUDIT] stage=${stage}${page !== null ? ` page=${page}` : ''} model=${model} reason=${reason} attempt=${attempt} cached=${cached} cost=$${unitCost.toFixed(4)} duration=${latencyMs}ms success=${success}`);
    }

    setCharacterMaster(cmData) {
        if (!cmData) return;
        this.characterMaster = {
            id: cmData.characterMasterId,
            version: cmData.characterMasterVersion || '1.0',
            model: cmData.modelUsed || 'black-forest-labs/flux-kontext-pro',
            promptVersion: cmData.promptVersion || 'cm_v1.0',
            masterUrl: cmData.masterUrl,
            cached: cmData.cached || false
        };
    }

    setCharacterSheet(csData) {
        if (!csData) return;
        this.characterSheet = {
            id: csData.characterSheetId,
            version: csData.version || '1.0',
            sheetUrl: csData.sheetUrl,
            cached: csData.cached || false
        };
    }

    recordCover({ reused = true, model = 'black-forest-labs/flux-kontext-pro', latencyMs = 0 }) {
        this.cover = {
            generated: !reused,
            reusedAfterPayment: reused,
            model,
            latencyMs
        };
    }

    recordPage({ page, attempts = 1, qualityRegenerations = 0, upscaleCalls = 0, latencyMs = 0 }) {
        this.pages.push({
            page,
            generationAttempts: attempts,
            qualityRegenerations,
            upscaleCalls,
            latencyMs
        });
    }

    finalize() {
        this.completedTime = Date.now();
        this.totalDurationMs = this.completedTime - this.startTime;
        return this.toJSON();
    }

    toJSON() {
        return {
            jobId: this.jobId,
            previewId: this.previewId,
            pipelineVersion: this.pipelineVersion,
            startTime: this.startTime,
            completedTime: this.completedTime,
            totalDurationMs: this.completedTime ? (this.completedTime - this.startTime) : null,
            characterMaster: this.characterMaster,
            characterSheet: this.characterSheet,
            cover: this.cover,
            pages: this.pages,
            summary: {
                totalAiGenerationCalls: this.totalAiGenerationCalls,
                totalUpscaleCalls: this.totalUpscaleCalls,
                estimatedAiCost: parseFloat(this.estimatedAiCost.toFixed(4))
            },
            aiCalls: this.aiCalls
        };
    }

    saveToDisk(booksFolder) {
        try {
            const manifestPath = path.join(booksFolder, `manifest_${this.jobId}.json`);
            fs.writeFileSync(manifestPath, JSON.stringify(this.toJSON(), null, 2));
            console.log(`📝 [MANIFEST] Saved order generation manifest to ${manifestPath} (Estimated AI cost: $${this.estimatedAiCost.toFixed(3)})`);
        } catch (err) {
            console.warn(`⚠️ [MANIFEST] Could not persist manifest_${this.jobId}.json:`, err.message);
        }
    }
}

module.exports = {
    OrderGenerationManifest,
    MODEL_COSTS
};
