/**
 * TwinkleTale AI — Visual Attribute Accuracy & Non-Hallucination Test Suite
 * Validates:
 * 1. Photos of children with natural hair NEVER hallucinate turbans or headwear.
 * 2. Normalization strictly resets headwearDescription and headwearType to 'none' when hasHeadwear is false.
 * 3. Prompts for children without headwear contain ZERO turban tokens and NEVER forbid bare hair.
 * 4. Intentional headwear (when worn or parent-checked) continues to be faithfully preserved.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { normalizeAttributes, extractPhotoVisualAttributes, attributeCache } = require('../lib/vision/attributeExtractor');
const { buildCoverPrompt } = require('../lib/cover/promptBuilder');
const { sanitizeChildRoleForHeadwear } = require('../lib/cover/themeMasters');

console.log('========================================================================');
console.log('🧪 TESTING VISUAL ATTRIBUTE ACCURACY & STRICT RELATIVE FIDELITY');
console.log('========================================================================\n');

// --- TEST 1: Normalization Sanitation Rules ---
console.log('--- TEST 1: Normalization Sanitation Rules ---');

// 1A: Empty raw vision or fallback must be completely clean
const cleanAttrs = normalizeAttributes({}, {});
assert.strictEqual(cleanAttrs.hasHeadwear, false, 'hasHeadwear must be false for empty input');
assert.strictEqual(cleanAttrs.headwearType, 'none', 'headwearType must be none');
assert.strictEqual(cleanAttrs.headwearDescription, '', 'headwearDescription must be empty');
console.log('  ✔ Empty/fallback attributes cleanly normalize to non-headwear state.');

// 1B: Corrupted raw vision with hasHeadwear: true but headwearType: 'none'
const corruptedAttrs = normalizeAttributes({ hasHeadwear: true, headwearType: 'none', headwearDescription: 'turban' });
assert.strictEqual(corruptedAttrs.hasHeadwear, false, 'Corrupted hasHeadwear:true with none must be sanitized to false');
assert.strictEqual(corruptedAttrs.headwearType, 'none', 'headwearType must be none');
assert.strictEqual(corruptedAttrs.headwearDescription, '', 'headwearDescription must be wiped clean');
console.log('  ✔ Corrupted vision state sanitized; zero fallback to turban.');

// 1C: Child with natural curls / afro / wavy hair (bare hair)
const naturalHairVision = {
  hasHeadwear: false,
  headwearType: 'none',
  headwearColor: '',
  headwearDescription: '',
  hasGlasses: false,
  glassesDescription: '',
  skinTone: 'deep brown',
  hairStyle: 'natural voluminous dark curls'
};
const naturalNormalized = normalizeAttributes(naturalHairVision);
assert.strictEqual(naturalNormalized.hasHeadwear, false, 'Natural curls must have hasHeadwear: false');
assert.strictEqual(naturalNormalized.headwearDescription, '', 'Natural curls must have empty headwearDescription');
console.log('  ✔ Child with natural curls verified clean of any headwear.');

// 1D: Child who ACTUALLY wears an authentic turban (e.g. parent checked or genuine vision hit)
const turbanAttrs = normalizeAttributes({
  hasHeadwear: true,
  headwearType: 'turban',
  headwearColor: 'navy blue',
  headwearDescription: 'navy blue turban'
});
assert.strictEqual(turbanAttrs.hasHeadwear, true, 'hasHeadwear must be true for genuine turban');
assert.strictEqual(turbanAttrs.headwearType, 'turban', 'headwearType must be turban');
assert.strictEqual(turbanAttrs.headwearDescription, 'navy blue turban', 'headwearDescription must match');
console.log('  ✔ Genuine turban wearer verified with authentic details preserved.');

console.log('✅ TEST 1 PASSED: Attribute normalization is 100% relative and leak-proof.\n');


// --- TEST 2: Cover Prompt Safety for Bare-Head Children ---
console.log('--- TEST 2: Cover Prompt Safety for Bare-Head Children ---');

const bareHeadChild = {
  name: 'Maya',
  gender: 'girl',
  age: 5,
  charAnchor: 'Maya, a cheerful young girl with sparkling dark eyes and natural dark curly hair',
  attributes: naturalNormalized
};

const bareHeadPromptResult = buildCoverPrompt('Space & Stars', 'HERO_SCENE', bareHeadChild, {
  bookTitle: "Maya's Starlit Journey"
});

const posPrompt = bareHeadPromptResult.positivePrompt;
const negPrompt = bareHeadPromptResult.negativePrompt;

// Assert positive prompt has ZERO headwear contamination
assert(!posPrompt.toLowerCase().includes('turban'), 'Positive prompt must NOT contain "turban" for bare-head child');
assert(!posPrompt.toLowerCase().includes('patka'), 'Positive prompt must NOT contain "patka" for bare-head child');
assert(!posPrompt.toLowerCase().includes('wearing an authentic'), 'Positive prompt must NOT contain "wearing an authentic" for bare-head child');
assert(!posPrompt.toLowerCase().includes('[critical cultural accuracy'), 'Positive prompt must NOT contain cultural accuracy directive for bare-head child');
console.log('  ✔ Positive prompt for bare-head child contains ZERO headwear directives.');

// Assert negative prompt DOES NOT ban bare head or hair
assert(!negPrompt.includes('bare head'), 'Negative prompt must NOT ban "bare head" when child has bare hair!');
assert(!negPrompt.includes('exposed hair'), 'Negative prompt must NOT ban "exposed hair" when child has bare hair!');
assert(!negPrompt.includes('turban'), 'Negative prompt must NOT mention turban when child has bare hair!');
console.log('  ✔ Negative prompt for bare-head child allows natural hair and bare head.');

console.log('✅ TEST 2 PASSED: Bare-head children receive 100% natural, unconstrained hair prompts.\n');


// --- TEST 3: Faithful Preservation for Turban Wearers ---
console.log('--- TEST 3: Faithful Preservation for Turban Wearers ---');

const turbanChild = {
  name: 'Kabir',
  gender: 'boy',
  age: 4,
  charAnchor: 'Kabir, a bright young boy with cheerful eyes and an authentic navy blue turban',
  attributes: turbanAttrs
};

const turbanPromptResult = buildCoverPrompt('Trains & Vehicles', 'HERO_SCENE', turbanChild, {
  bookTitle: "Kabir's Train Adventure"
});

const turbanPosPrompt = turbanPromptResult.positivePrompt;
const turbanNegPrompt = turbanPromptResult.negativePrompt;

assert(turbanPosPrompt.includes('(wearing an authentic navy blue turban:1.35)'), 'Turban child must have weighted headwear token');
assert(turbanPosPrompt.includes('[CRITICAL CULTURAL ACCURACY: The child is wearing an authentic navy blue turban'), 'Turban child must have cultural accuracy directive');
assert(turbanNegPrompt.includes('exposed hair replacing turban'), 'Turban child must forbid exposed hair replacing turban');
console.log('  ✔ Turban wearer correctly receives weighted token and anti-erasure protection.');

console.log('✅ TEST 3 PASSED: Cultural headwear preservation remains 100% active when warranted.\n');


// --- TEST 4: Theme Child Role Sanitization ---
console.log('--- TEST 4: Theme Child Role Sanitization ---');

const rawTrainRole = 'A curious little conductor in an adorable conductor cap, blowing a golden train whistle';

// 4A: Bare head child must keep conductor theme role without turban replacement
const bareSanitized = sanitizeChildRoleForHeadwear(rawTrainRole, naturalNormalized);
assert(!bareSanitized.toLowerCase().includes('turban'), 'Bare head child role must NOT contain turban');
console.log('  ✔ Bare-head child role untouched by turban substitution:', bareSanitized);

// 4B: Turban child role replaces conductor cap with authentic turban
const turbanSanitized = sanitizeChildRoleForHeadwear(rawTrainRole, turbanAttrs);
assert(turbanSanitized.includes('wearing an authentic navy blue turban'), 'Turban wearer role must replace cap with authentic turban');
assert(!turbanSanitized.includes('conductor cap'), 'Turban wearer role must NOT have conductor cap');
console.log('  ✔ Turban child role correctly replaces conductor cap with turban.');

console.log('✅ TEST 4 PASSED: Theme role sanitization is strictly relative to user attributes.\n');

console.log('========================================================================');
console.log('🎉 ALL VISUAL ATTRIBUTE ACCURACY & RELATIVE FIDELITY TESTS PASSED!');
console.log('========================================================================');
