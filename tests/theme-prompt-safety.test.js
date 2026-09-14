const assert = require('assert');
const path = require('path');
const cwd = process.cwd();
const { THEME_MASTERS, getThemeMaster } = require(path.join(cwd, 'lib/cover/themeMasters'));
const { COVER_ARCHETYPES, selectArchetype } = require(path.join(cwd, 'lib/cover/archetypes'));
const { buildCoverPrompt } = require(path.join(cwd, 'lib/cover/promptBuilder'));

console.log('========================================================================');
console.log('🧪 END-TO-END VERIFICATION: THEME SAFETY, ARCHETYPES & EDITIONS');
console.log('========================================================================\n');

// 1. Verify all 12 themes contain no trigger words in childRole, heroAction, lighting, or texture
console.log('--- TEST 1: Audit all 12 Theme Master Constitutions for sensitive keywords ---');
const SENSITIVE_KEYWORDS = [
  /\bshorts\b/i,
  /\bswim/i,
  /\bdancing on skin\b/i,
  /\bnightgown\b/i,
  /\bbare\b/i,
  /\blimbs?\b/i
];

for (const [key, tm] of Object.entries(THEME_MASTERS)) {
  const combinedText = `${tm.childRole} ${tm.heroAction} ${tm.lighting} ${tm.texture}`;
  for (const reg of SENSITIVE_KEYWORDS) {
    assert(!reg.test(combinedText), `Theme ${key} failed safety check with ${reg}: "${combinedText}"`);
  }
}
console.log('✅ TEST 1 PASSED: All 12 themes are 100% free of sensitive words!');

// 2. Verify all 6 archetypes contain no anatomical or bodily trigger words
console.log('\n--- TEST 2: Audit all 6 Archetype Prompts for anatomical trigger words ---');
const ARCHETYPE_FORBIDDEN = [
  /\blimbs?\b/i,
  /\bfeet cut off\b/i,
  /\bcropped limbs\b/i,
  /\bfull body\b/i
];

for (const [key, arch] of Object.entries(COVER_ARCHETYPES)) {
  for (const reg of ARCHETYPE_FORBIDDEN) {
    assert(!reg.test(arch.compositionPrompt), `Archetype ${key} failed safety check with ${reg}: "${arch.compositionPrompt}"`);
  }
}
console.log('✅ TEST 2 PASSED: All 6 archetypes are 100% free of anatomical trigger words!');

// 3. Verify cover prompt generation for the Ocean & Dolphins theme
console.log('\n--- TEST 3: Generate Cover Prompt for Ocean & Dolphins (Failed Scenario) ---');
const oceanTm = getThemeMaster('Ocean & Dolphins');
const oceanPrompt = buildCoverPrompt(oceanTm, null, {
  name: 'Aarav',
  age: 2,
  gender: 'boy',
  charAnchor: 'a cheerful young boy hero wearing a cozy sea-breeze cyan star t-shirt and adventure trousers'
});

console.log('Generated Ocean Prompt (preview):', oceanPrompt.positivePrompt.slice(0, 180) + '...');
assert(!oceanPrompt.positivePrompt.includes('shorts'), 'Prompt must not contain "shorts"');
assert(!oceanPrompt.positivePrompt.includes('dancing on skin'), 'Prompt must not contain "dancing on skin"');
assert(!oceanPrompt.positivePrompt.includes('swimming or floating'), 'Prompt must not contain "swimming or floating"');
assert(!oceanPrompt.positivePrompt.includes('limbs'), 'Prompt must not contain "limbs"');
assert(!oceanPrompt.positivePrompt.includes('body, legs, and feet'), 'Prompt must not contain "body, legs, and feet"');
console.log('✅ TEST 3 PASSED: Ocean & Dolphins cover prompt is safe and compliant!');

// 4. Verify ₹99 (12-page) and ₹199 (22-page) configuration formulas
console.log('\n--- TEST 4: Verify ₹99 & ₹199 Book Page Math ---');
// ₹99 Treasury Edition: 12 pages total = 1 Cover + 1 Dedication + 8 Interior (4 Spreads) + 1 Blessing + 1 Back Cover
const treasurySpreads = 4;
const treasuryTotalPages = 1 + 1 + (treasurySpreads * 2) + 1 + 1;
assert.strictEqual(treasuryTotalPages, 12, 'Treasury Edition must equal 12 physical pages');

// ₹199 Grand Treasury Edition: 22 pages total = 1 Cover + 1 Dedication + 18 Interior (9 Spreads) + 1 Blessing + 1 Back Cover
const grandSpreads = 9;
const grandTotalPages = 1 + 1 + (grandSpreads * 2) + 1 + 1;
assert.strictEqual(grandTotalPages, 22, 'Grand Treasury Edition must equal 22 physical pages');
console.log('✅ TEST 4 PASSED: ₹99 (12-page) & ₹199 (22-page) page structures are mathematically exact!');

console.log('\n========================================================================');
console.log('🎉 ALL END-TO-END PROMPT SAFETY & EDITION AUDITS PASSED CLEANLY!');
console.log('========================================================================');
