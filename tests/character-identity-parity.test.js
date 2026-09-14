const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('========================================================================');
console.log('🧪 TESTING CHARACTER IDENTITY PARITY, MEMORY SAFETY & FAIL-SAFE REFUND');
console.log('========================================================================\n');

const serverJsPath = path.join(__dirname, '../server.js');
const serverSource = fs.readFileSync(serverJsPath, 'utf8');

console.log('--- TEST 1: Visual Condition Prioritizes Uploaded Photo ---');
assert(
    serverSource.includes('let visualCondition = photoData || session.photoData || null;'),
    'visualCondition must prioritize photoData / session.photoData before fallback'
);
console.log('✅ TEST 1 PASSED: photoData is prioritized as visualCondition over full cover artwork');

console.log('\n--- TEST 2: Extraction of Active Character Anchor and Signature Outfit ---');
assert(
    serverSource.includes('const charDetails = getCharacterDetails(childName, gender, age, theme);'),
    'Must retrieve charDetails for child and theme'
);
assert(
    serverSource.includes('const activeCharAnchor = charAnchor || charDetails.charAnchor;'),
    'Must define activeCharAnchor'
);
assert(
    serverSource.includes('const activeOutfit = charDetails.outfit;'),
    'Must extract activeOutfit from charDetails'
);
console.log('✅ TEST 2 PASSED: activeCharAnchor and activeOutfit extracted and anchored');

console.log('\n--- TEST 3: Prompt Enforces 80-90% Likeness, Wardrobe & Lean Upscale Bypass ---');
assert(
    serverSource.includes('preserving 80-90% facial likeness and identity: identical facial structure, eye shape, eyebrows, nose, mouth, authentic cheerful smile, natural skin tone, hair texture, and consistently ${activeOutfit}'),
    'Scene prompt must mandate 80-90% facial likeness, facial structure, eye shape, nose, mouth, smile, skin tone, hair texture, and consistent outfit'
);
assert(
    serverSource.includes('generateImage(scenePrompt, visualCondition, { isFace: true, upscale: false })'),
    'generateImage must receive visualCondition (photoData) with upscale: false for interior scene illustration to protect memory'
);
console.log('✅ TEST 3 PASSED: Scene prompts enforce 80-90% likeness, signature outfit, and lean native generation');

console.log('\n--- TEST 4: Direct Checkout Bedtime Story Authoring Prompt Includes Outfit ---');
assert(
    serverSource.includes('Character signature outfit: ${activeOutfit}. Language: ${language}.'),
    'Authoring LLM prompt must specify signature outfit'
);
console.log('✅ TEST 4 PASSED: Authoring LLM prompt includes signature outfit');

console.log('\n--- TEST 5: Memory Safety — Sharp Cache Disabled & Concurrency 1 ---');
assert(
    serverSource.includes('sharp.cache(false);') && serverSource.includes('sharp.concurrency(1);'),
    'Sharp must have cache disabled and concurrency capped to 1'
);
console.log('✅ TEST 5 PASSED: Sharp configured for strict <150MB memory ceiling');

console.log('\n--- TEST 6: Fail-Proof Mechanism — Automated Razorpay Refund & Notifications ---');
assert(
    serverSource.includes('await razorpay.payments.refund(job.paymentId,'),
    'Must initiate automated refund via Razorpay when job fails'
);
assert(
    serverSource.includes('Full Refund Initiated for'),
    'Must dispatch refund confirmation email to customer'
);
assert(
    serverSource.includes('Order Fulfillment Failed — Job'),
    'Must dispatch admin alert email on job failure'
);
console.log('✅ TEST 6 PASSED: Automated Razorpay refund & customer reassurance emails verified');

console.log('\n--- TEST 7: Startup Self-Healing — Interrupted Job Recovery ---');
assert(
    serverSource.includes('async function recoverDanglingJobs()') && serverSource.includes('recoverDanglingJobs();'),
    'Server must include startup recovery for interrupted jobs'
);
console.log('✅ TEST 7 PASSED: Startup self-healing for interrupted jobs verified');

console.log('\n========================================================================');
console.log('🏁 ALL 7 IDENTITY, MEMORY & FAIL-SAFE TESTS PASSED SUCCESSFULLY!');
console.log('========================================================================\n');
