const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const { createCharacterProfile } = require('../lib/character/characterProfile');
const { buildCharacterMasterPrompt, getCachedCharacterMaster, saveCharacterMaster } = require('../lib/character/characterMaster');
const { getOrGenerateCharacterSheet, getCachedCharacterSheet, saveCharacterSheet } = require('../lib/character/characterSheet');
const { validateImageQuality, PageRegenerationBudget } = require('../lib/character/characterQA');
const { OrderGenerationManifest, MODEL_COSTS } = require('../lib/observability/generationManifest');

console.log('========================================================================');
console.log('🧪 TESTING CHARACTER MASTER v1 & AI CREDIT OPTIMIZATION SUITE');
console.log('========================================================================\n');

// ── TEST 1: Character Profile Isolation & Feature Detection ─────────────────
console.log('--- TEST 1: Character Profile Attribute Isolation ---');
const dummyPhotoA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const profileA = createCharacterProfile({
    childName: 'Aarav',
    gender: 'boy',
    age: 6,
    theme: 'Space Adventure',
    attributes: {
        hasHeadwear: true,
        headwearType: 'turban',
        headwearDescription: 'authentic blue patka turban',
        hasGlasses: false,
        skinTone: 'warm bronze'
    },
    photoData: dummyPhotoA
});

assert.strictEqual(profileA.childName, 'Aarav');
assert.strictEqual(profileA.attributes.hasHeadwear, true);
assert.strictEqual(profileA.attributes.headwearType, 'turban');
assert.strictEqual(profileA.attributes.hasGlasses, false);
assert.strictEqual(profileA.attributes.skinTone, 'warm bronze');
assert.ok(profileA.photoHash, 'Photo hash must be generated');
console.log('  ✔ Aarav profile isolated with authentic turban and warm bronze skin');

const profileB = createCharacterProfile({
    childName: 'Emma',
    gender: 'girl',
    age: 5,
    theme: 'Magical Forest',
    attributes: {
        hasHeadwear: false,
        hasGlasses: true,
        glassesDescription: 'round red spectacles',
        skinTone: 'fair peach'
    }
});

assert.strictEqual(profileB.childName, 'Emma');
assert.strictEqual(profileB.attributes.hasHeadwear, false);
assert.strictEqual(profileB.attributes.hasGlasses, true);
assert.strictEqual(profileB.attributes.skinTone, 'fair peach');
assert.notStrictEqual(profileA.attributes.hasHeadwear, profileB.attributes.hasHeadwear);
assert.notStrictEqual(profileA.attributes.hasGlasses, profileB.attributes.hasGlasses);
console.log('  ✔ Emma profile isolated with round red spectacles and no headwear (Zero cross-contamination)');
console.log('✅ TEST 1 PASSED: Character Profile correctly isolates attributes per child.\n');

// ── TEST 2: Character Master v1 Prompt Directives & Caching ─────────────────
console.log('--- TEST 2: Character Master v1 Prompt & Immutability Caching ---');
const masterPromptA = buildCharacterMasterPrompt(profileA);
assert.ok(masterPromptA.includes('authentic blue patka turban'), 'Prompt must mandate authentic turban');
assert.ok(masterPromptA.includes('STRICT EYEWEAR RESTRICTION: The child does NOT wear glasses'), 'Must forbid glasses when absent');
assert.ok(masterPromptA.includes('warm bronze'), 'Must include skin colouring');

const masterPromptB = buildCharacterMasterPrompt(profileB);
assert.ok(masterPromptB.includes('round red spectacles'), 'Prompt must mandate round red spectacles');
assert.ok(masterPromptB.includes('STRICT HEADWEAR RESTRICTION: The child has natural hair with NO headwear'), 'Must forbid headwear when absent');

const testHash = `testhash_${Date.now()}`;
const mockMasterData = {
    characterMasterId: `cm_${testHash}_v1`,
    photoHash: testHash,
    childName: 'Aarav',
    masterUrl: 'https://cdn.twinkletale.test/master_aarav.png'
};
saveCharacterMaster(testHash, mockMasterData);
const retrieved = getCachedCharacterMaster(testHash);
assert.deepStrictEqual(retrieved, mockMasterData, 'Cached Character Master must match saved data');
console.log('  ✔ Master Prompt correctly embeds cultural headwear & glasses directives');
console.log('  ✔ Master caching and persistence operates deterministically');
console.log('✅ TEST 2 PASSED: Character Master v1 prompt & caching verified.\n');

// ── TEST 3: Character Sheet Generation ──────────────────────────────────────
console.log('--- TEST 3: Character Sheet Canonical Wardrobe & Spec ---');
(async () => {
    const sheetSpec = await getOrGenerateCharacterSheet({
        characterMaster: mockMasterData,
        profile: profileA
    });
    assert.strictEqual(sheetSpec.characterMasterId, mockMasterData.characterMasterId);
    assert.ok(sheetSpec.canonicalWardrobe, 'Character Sheet must contain canonical wardrobe');
    assert.strictEqual(sheetSpec.primaryPortraitUrl, mockMasterData.masterUrl);
    console.log('  ✔ Character Sheet references Character Master ID:', sheetSpec.characterMasterId);
    console.log('  ✔ Canonical wardrobe anchored:', sheetSpec.canonicalWardrobe);
    console.log('✅ TEST 3 PASSED: Character Sheet spec verified.\n');
})();

// ── TEST 4: Character QA & Page Regeneration Budget ─────────────────────────
console.log('--- TEST 4: Character QA & Page Budget Enforcer ---');
(async () => {
    // 4.1 Empty / invalid buffer QA
    const emptyQa = await validateImageQuality(null);
    assert.strictEqual(emptyQa.valid, false, 'Null buffer must fail QA');

    const tinyBuf = Buffer.from('too small');
    const tinyQa = await validateImageQuality(tinyBuf, { minBytes: 5000 });
    assert.strictEqual(tinyQa.valid, false, 'Small buffer (<5000 bytes) must fail QA');

    // 4.2 Valid 3:4 image buffer QA
    const valid34Img = await sharp({
        create: {
            width: 300,
            height: 400,
            channels: 3,
            background: { r: 100, g: 150, b: 200 }
        }
    }).jpeg().toBuffer();

    const validQa = await validateImageQuality(valid34Img, { minBytes: 500, expectedRatio: 0.75 });
    assert.strictEqual(validQa.valid, true, `Valid 3:4 image buffer must pass QA (${validQa.reason})`);
    assert.strictEqual(validQa.metrics.width, 300);
    assert.strictEqual(validQa.metrics.height, 400);
    console.log('  ✔ Image buffer deterministic QA validation functional');

    // 4.3 Page Regeneration Budget (Strict max 1 quality retry)
    const budget = new PageRegenerationBudget(1);
    assert.strictEqual(budget.canRegenerate(0), true, 'First attempt must allow regeneration');
    budget.recordAttempt(0);
    assert.strictEqual(budget.canRegenerate(0), false, 'Exceeded budget must reject second regeneration attempt');
    assert.strictEqual(budget.getAttempts(0), 1);
    console.log('  ✔ PageRegenerationBudget enforces MAX_PAGE_QUALITY_REGENERATIONS = 1 strictly');
    console.log('✅ TEST 4 PASSED: Character QA & budget limits verified.\n');

    // ── TEST 5: Generation Manifest Observability & Cost Tracking ────────────
    console.log('--- TEST 5: Generation Manifest & AI Credit Audit ---');
    const manifest = new OrderGenerationManifest('job_test_123', 'prev_test_456');
    manifest.setCharacterMaster(mockMasterData);
    manifest.recordCover({ reused: true, model: 'black-forest-labs/flux-kontext-pro' });

    // Simulate 12 page generations
    for (let p = 1; p <= 12; p++) {
        manifest.recordAiCall({
            stage: 'page_generation',
            page: p,
            model: 'black-forest-labs/flux-kontext-pro',
            reason: 'initial_generation',
            attempt: 1,
            latencyMs: 3200,
            success: true
        });
        manifest.recordPage({
            page: p,
            attempts: 1,
            qualityRegenerations: 0,
            upscaleCalls: 0,
            latencyMs: 3200
        });
    }

    const summary = manifest.finalize();
    assert.strictEqual(summary.summary.totalAiGenerationCalls, 12, 'Must record 12 generation calls');
    assert.strictEqual(summary.summary.totalUpscaleCalls, 0, 'Must record 0 AI upscales (local Sharp used)');
    // 12 * $0.040 = $0.480
    assert.strictEqual(summary.summary.estimatedAiCost, 0.48, 'Estimated cost must equal $0.48 for 12 spreads');
    assert.strictEqual(summary.cover.reusedAfterPayment, true, 'Cover must be marked as reused after payment');

    const manifestBooksDir = path.join(__dirname, '..', 'books');
    manifest.saveToDisk(manifestBooksDir);
    const diskPath = path.join(manifestBooksDir, 'manifest_job_test_123.json');
    assert.ok(fs.existsSync(diskPath), 'Manifest JSON must be written to disk');
    const diskContent = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
    assert.strictEqual(diskContent.jobId, 'job_test_123');
    fs.unlinkSync(diskPath); // Clean up test file

    console.log(`  ✔ Order manifest successfully tracked 12 pages with $${summary.summary.estimatedAiCost} cost`);
    console.log('  ✔ Cover marked reused: true ($0.00 redundant cover cost eliminated)');
    console.log('  ✔ Zero AI upscales ($0.00 redundant upscaler cost eliminated)');
    console.log('✅ TEST 5 PASSED: Observability and credit auditing verified.\n');

    console.log('========================================================================');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY IN CHARACTER MASTER SUITE');
    console.log('========================================================================\n');
})();
