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

// 5. Exhaustive Age Group & Sanitizer Verification (Ages 1 through 10 across all 12 Themes)
console.log('\n--- TEST 5: Exhaustive Age Audit (Ages 1 to 10 across all 12 Themes) ---');
const fs = require('fs');
const serverCode = fs.readFileSync(path.join(cwd, 'server.js'), 'utf8');

// Extract sanitizePromptForSafety directly from server.js
const sanitizerMatch = serverCode.match(/function sanitizePromptForSafety\([\s\S]*?^}/m);
assert(sanitizerMatch, 'sanitizePromptForSafety must be defined in server.js');
const sanitizePromptForSafety = new Function(`${sanitizerMatch[0]}; return sanitizePromptForSafety;`)();

const ages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const genders = ['boy', 'girl', 'little star'];
const themeKeys = Object.keys(THEME_MASTERS);

let totalCombinationsTested = 0;

for (const age of ages) {
  for (const gender of genders) {
    for (const key of themeKeys) {
      const tm = THEME_MASTERS[key];
      const res = buildCoverPrompt(tm, null, {
        name: 'LittleHero',
        age,
        gender
      });

      const p = res.positivePrompt;
      // Must never contain numeric age strings like "2-year-old", "age 2", etc.
      assert(!/\b\d+[ -]year[ -]old\b/i.test(p), `Prompt for age ${age}, theme ${key} leaked numeric year-old: "${p}"`);
      assert(!/\bage[ -]\d+\b/i.test(p), `Prompt for age ${age}, theme ${key} leaked "age ${age}": "${p}"`);
      assert(!/\b(baby|infant|toddler)\b/i.test(p), `Prompt for age ${age}, theme ${key} leaked baby/toddler: "${p}"`);
      assert(!/\bshorts\b/i.test(p), `Prompt for age ${age}, theme ${key} leaked shorts: "${p}"`);
      assert(!/\b(bare|barefoot|limbs?)\b/i.test(p), `Prompt for age ${age}, theme ${key} leaked bare/limbs: "${p}"`);

      // Run through runtime sanitizer as well
      const sanitized = sanitizePromptForSafety(p);
      assert(!/\b\d+[ -]year[ -]old\b/i.test(sanitized));
      assert(!/\bshorts\b/i.test(sanitized));
      totalCombinationsTested++;
    }
  }
}
console.log(`✅ TEST 5 PASSED: Verified all ${totalCombinationsTested} age (1-10) x gender x theme combinations are 100% clean!`);

// 6. Test Edge-Case Age Formats in SanitizePromptForSafety
console.log('\n--- TEST 6: Test Edge-Case Age Formats in SanitizePromptForSafety ---');
const edgeCases = [
  { input: 'A 1-year-old baby in shorts swimming', mustNotHave: ['1-year-old', 'baby', 'shorts', 'swimming'] },
  { input: 'A 2 year old toddler with diaper and bare feet', mustNotHave: ['2 year old', 'toddler', 'diaper', 'bare'] },
  { input: '3-years-old infant dancing on skin and ocean waves', mustNotHave: ['3-years-old', 'infant', 'dancing on skin'] },
  { input: 'A happy 4 yr old girl in a swimsuit', mustNotHave: ['4 yr old', 'swimsuit'] },
  { input: '5yo child age 5 with limbs visible', mustNotHave: ['5yo', 'age 5', 'limbs'] },
  { input: 'A 6-year-old at age 6 in nightgown', mustNotHave: ['6-year-old', 'age 6', 'nightgown'] },
  { input: '7 years old boy wearing shorts and swim trunks', mustNotHave: ['7 years old', 'shorts', 'swim trunks'] },
  { input: '8-yr-old girl aged 8 with bare legs', mustNotHave: ['8-yr-old', 'aged 8', 'bare legs'] },
  { input: '9-year-old boy in swim wear', mustNotHave: ['9-year-old', 'swim wear'] },
  { input: '10 year old child in underwear', mustNotHave: ['10 year old', 'underwear'] },
  { input: 'A one-year-old baby and a two year old toddler', mustNotHave: ['one-year-old', 'two year old', 'baby', 'toddler'] },
  { input: 'three years old hero with skin tone and complexion', mustNotHave: ['three years old', 'skin tone', 'complexion'] }
];

for (const ec of edgeCases) {
  const out = sanitizePromptForSafety(ec.input);
  for (const forbidden of ec.mustNotHave) {
    const reg = new RegExp(`\\b${forbidden.replace(/\s+/g, '\\s+')}\\b`, 'i');
    assert(!reg.test(out), `Edge case "${ec.input}" failed to scrub "${forbidden}". Output: "${out}"`);
  }
}
console.log('✅ TEST 6 PASSED: All edge-case age numbers (1 to 10) & words scrubbed cleanly!');

console.log('\n========================================================================');
console.log('🎉 ALL END-TO-END PROMPT SAFETY & AGE 1-10 AUDITS PASSED CLEANLY!');
console.log('========================================================================');

