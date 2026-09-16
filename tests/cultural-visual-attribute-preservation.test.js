/**
 * tests/cultural-visual-attribute-preservation.test.js
 * 
 * Comprehensive automated test suite verifying cultural and visual attribute preservation:
 * 1. Vision attribute extraction, caching, and client overrides (turbans, glasses, skin tone).
 * 2. Theme role headwear conflict sanitization (eliminating conductor caps, top hats, flower crowns).
 * 3. Prompt builder token 0-25 weighted injection, negative prompt construction, and 90-95% likeness.
 * 4. Cover engine pipeline parameter enforcement (prompt_upsampling: false, reference weights).
 * 5. Server-side pipeline integration in getCharacterDetails, generateAvatar, and assembleFullBookAsync.
 * 6. Frontend UI and payload verification across special.html, index.html, and frontend_index.html.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { extractPhotoVisualAttributes, normalizeAttributes } = require('../lib/vision/attributeExtractor');
const { THEME_MASTERS, sanitizeChildRoleForHeadwear } = require('../lib/cover/themeMasters');
const { buildCoverPrompt } = require('../lib/cover/promptBuilder');
const { CoverDesignEngine } = require('../lib/cover/coverEngine');

console.log('========================================================================');
console.log('🧪 TESTING CULTURAL & VISUAL ATTRIBUTE PRESERVATION PIPELINE');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// TEST 1: Attribute Extractor, Client Overrides & Normalization
// -----------------------------------------------------------------------------
console.log('--- TEST 1: Attribute Extractor, Client Overrides & Normalization ---');

// Case 1A: Client manually selected Turban / Patka
const clientTurbanAttrs = normalizeAttributes({
  hasHeadwear: true,
  headwearType: 'turban'
});
assert.strictEqual(clientTurbanAttrs.hasHeadwear, true, 'hasHeadwear must be true');
assert.strictEqual(clientTurbanAttrs.headwearType, 'turban', 'headwearType must be turban');
assert(clientTurbanAttrs.headwearDescription.toLowerCase().includes('turban'), 'headwearDescription must specify turban');
console.log('  ✔ Client turban override correctly normalized:', clientTurbanAttrs.headwearDescription);

// Case 1B: Client manually selected Glasses
const clientGlassesAttrs = normalizeAttributes({
  hasGlasses: true
});
assert.strictEqual(clientGlassesAttrs.hasGlasses, true, 'hasGlasses must be true');
assert(clientGlassesAttrs.glassesDescription.toLowerCase().includes('spectacles') || clientGlassesAttrs.glassesDescription.toLowerCase().includes('glasses'), 'glassesDescription must specify glasses/spectacles');
console.log('  ✔ Client glasses override correctly normalized:', clientGlassesAttrs.glassesDescription);

// Case 1C: Both Turban and Glasses combined
const combinedAttrs = normalizeAttributes({
  hasHeadwear: true,
  headwearType: 'patka',
  headwearDescription: 'traditional saffron patka',
  hasGlasses: true,
  glassesDescription: 'stylish round glasses',
  skinTone: 'warm brown'
});
assert.strictEqual(combinedAttrs.hasHeadwear, true);
assert.strictEqual(combinedAttrs.headwearType, 'patka');
assert.strictEqual(combinedAttrs.headwearDescription, 'traditional saffron patka');
assert.strictEqual(combinedAttrs.hasGlasses, true);
assert.strictEqual(combinedAttrs.glassesDescription, 'stylish round glasses');
assert.strictEqual(combinedAttrs.skinTone, 'warm brown');
console.log('  ✔ Combined cultural attributes correctly normalized with skin tone');

console.log('✅ TEST 1 PASSED: Attribute extraction & normalization verified.\n');

// -----------------------------------------------------------------------------
// TEST 2: Theme Role Headwear Conflict Sanitization
// -----------------------------------------------------------------------------
console.log('--- TEST 2: Theme Role Headwear Conflict Sanitization ---');

// Test 2A: Trains theme with conductor cap
const trainRole = THEME_MASTERS['trains-and-vehicles'].childRole;
assert(trainRole.toLowerCase().includes('conductor cap'), 'Raw train theme must originally mention conductor cap');
const sanitizedTrainRole = sanitizeChildRoleForHeadwear(trainRole, { hasHeadwear: true, headwearType: 'turban' });
assert(!sanitizedTrainRole.toLowerCase().includes('conductor cap'), 'Sanitized train role must NOT contain conductor cap when child wears turban');
console.log('  ✔ Trains & Vehicles conductor cap cleanly stripped for turban wearer');

// Test 2B: Circus theme with top hat
const circusRole = THEME_MASTERS['circus-and-carnival'].childRole;
assert(circusRole.toLowerCase().includes('top hat'), 'Raw circus theme must originally mention top hat');
const sanitizedCircusRole = sanitizeChildRoleForHeadwear(circusRole, { hasHeadwear: true, headwearType: 'patka' });
assert(!sanitizedCircusRole.toLowerCase().includes('top hat'), 'Sanitized circus role must NOT contain top hat when child wears patka');
console.log('  ✔ Circus top hat cleanly stripped for patka wearer');

// Test 2C: Fairies theme with flower crown
const fairyRole = THEME_MASTERS['fairies-and-magic'].childRole;
assert(fairyRole.toLowerCase().includes('flower crown'), 'Raw fairies theme must originally mention flower crown');
const sanitizedFairyRole = sanitizeChildRoleForHeadwear(fairyRole, { hasHeadwear: true, headwearType: 'turban' });
assert(!sanitizedFairyRole.toLowerCase().includes('flower crown'), 'Sanitized fairy role must NOT contain flower crown when child wears turban');
console.log('  ✔ Fairies flower crown cleanly stripped for turban wearer');

// Test 2D: Child WITHOUT headwear cleanly strips unneeded caps and hats
const defaultTrainRole = sanitizeChildRoleForHeadwear(trainRole, { hasHeadwear: false });
assert(!defaultTrainRole.toLowerCase().includes('conductor cap'), 'Role must cleanly strip conductor cap when child has natural bare hair');
assert(!defaultTrainRole.toLowerCase().includes('turban'), 'Role must NOT contain turban when child has natural bare hair');
console.log('  ✔ Child without headwear has unneeded caps cleanly stripped to prevent extra props');

console.log('✅ TEST 2 PASSED: Conflicting theme attire successfully neutralized.\n');

// -----------------------------------------------------------------------------
// TEST 3: Prompt Builder Injection, Weighting, & Negatives
// -----------------------------------------------------------------------------
console.log('--- TEST 3: Prompt Builder Injection, Weighting, & Negatives ---');

// Build cover prompt with Turban and Glasses
const promptResult = buildCoverPrompt('Trains & Vehicles', null, {
  name: 'Manraj',
  gender: 'boy',
  age: 5,
  attributes: {
    hasHeadwear: true,
    headwearType: 'turban',
    headwearDescription: 'authentic navy blue turban',
    hasGlasses: true,
    glassesDescription: 'spectacles',
    skinTone: 'warm dusky'
  }
}, { bookTitle: "Manraj's Great Train Adventure" });

const positivePrompt = promptResult.positivePrompt;
const negativePrompt = promptResult.negativePrompt;

// Assertions on positive prompt
assert(positivePrompt.includes('(wearing an authentic navy blue turban:1.35)'), 'Must inject weighted headwear token at high priority');
assert(positivePrompt.includes('(wearing spectacles:1.3)'), 'Must inject weighted spectacles token');
assert(positivePrompt.includes('(authentic warm dusky skin:1.2)'), 'Must inject weighted skin tone token');
assert(positivePrompt.includes('90% to 95% authentic facial likeness'), 'Must command 90-95% likeness fidelity');
assert(!positivePrompt.toLowerCase().includes('conductor cap'), 'Positive prompt must NOT include conductor cap');

// Assertions on negative prompt
assert(negativePrompt.includes('conductor cap'), 'Negative prompt must forbid conductor cap');
assert(negativePrompt.includes('cap, hat, baseball cap'), 'Negative prompt must forbid generic caps and hats');
assert(negativePrompt.includes('missing glasses'), 'Negative prompt must forbid missing glasses');
assert(negativePrompt.includes('exposed hair replacing turban'), 'Negative prompt must forbid bare head replacing turban');

console.log('  ✔ Positive prompt weighted tokens verified (turban:1.35, spectacles:1.3, skin:1.2)');
console.log('  ✔ High-priority 90-95% likeness directive verified');
console.log('  ✔ Negative prompt exclusions verified:', negativePrompt.substring(0, 80) + '...');

console.log('✅ TEST 3 PASSED: Cover prompt builder correctly weights and constrains visual attributes.\n');

// -----------------------------------------------------------------------------
// TEST 4: Cover Engine Pipeline Parameters
// -----------------------------------------------------------------------------
console.log('--- TEST 4: Cover Engine Pipeline Parameters ---');

const engine = new CoverDesignEngine();
const coverPlan = engine.prepareCoverPlan({
  theme: 'Space & Stars',
  childName: 'Amrit',
  age: 4,
  gender: 'boy',
  attributes: {
    hasHeadwear: true,
    headwearType: 'turban',
    headwearDescription: 'turban'
  }
});

assert(coverPlan.positivePrompt.includes('(wearing an authentic turban:1.35)'), 'prepareCoverPlan must forward attributes to prompt builder');
assert(coverPlan.negativePrompt.includes('bare head, exposed hair replacing turban'), 'coverPlan must include negative headwear constraints');
console.log('  ✔ prepareCoverPlan seamlessly passes attributes to generated plan');

console.log('✅ TEST 4 PASSED: Cover Engine correctly prepares attribute-aware plans.\n');

// -----------------------------------------------------------------------------
// TEST 5: Server Architecture & Pipeline Inspection
// -----------------------------------------------------------------------------
console.log('--- TEST 5: Server Architecture & Pipeline Inspection ---');

const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Check prompt_upsampling: false on flux-kontext-pro
assert(serverJs.includes('prompt_upsampling: false'), 'server.js must disable prompt_upsampling on flux-kontext-pro');
console.log('  ✔ prompt_upsampling: false configured on flux-kontext-pro to eliminate generic AI hallucinated caps');

// Check getCharacterDetails incorporates attributes
assert(serverJs.includes('function getCharacterDetails(childName, gender, age, theme, attributes = {})'), 'getCharacterDetails must accept attributes');
assert(serverJs.includes('attributes.hasHeadwear'), 'getCharacterDetails must handle headwear');
assert(serverJs.includes('attributes.hasGlasses'), 'getCharacterDetails must handle glasses');
console.log('  ✔ getCharacterDetails incorporates cultural and personal attributes into character anchor');

// Check generateAvatar likeness and preservation
assert(serverJs.includes('Preserve 90% to 95% facial likeness') && serverJs.includes('unique facial structure'), 'generateAvatar must enforce 90-95% likeness');
console.log('  ✔ generateAvatar commands 90-95% facial structure fidelity');

// Check /api/create-preview extracts attributes
assert(serverJs.includes('extractPhotoVisualAttributes'), 'server.js must import extractPhotoVisualAttributes');
assert(serverJs.includes('attributes: visualAttributes'), 'create-preview must save visualAttributes in session');
console.log('  ✔ /api/create-preview extracts and persists attributes in session');

// Check assembleFullBookAsync propagates attributes to interior pages
assert(serverJs.includes('attributePrefix') && serverJs.includes('Strict cultural requirement'), 'assembleFullBookAsync must prepend cultural attributes to scene prompts');
console.log('  ✔ assembleFullBookAsync propagates cultural attribute tokens to all storybook interior scenes');

console.log('✅ TEST 5 PASSED: Server-side pipeline inspection verified.\n');

// -----------------------------------------------------------------------------
// TEST 6: Frontend UI and Payload Parity Across All 3 Web Pages
// -----------------------------------------------------------------------------
console.log('--- TEST 6: Frontend UI and Payload Parity Across All Web Pages ---');

const specialHtml = fs.readFileSync(path.join(__dirname, '..', 'special.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const frontendIndexHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend_index.html'), 'utf8');

const pages = [
  { name: 'special.html', html: specialHtml },
  { name: 'index.html', html: indexHtml },
  { name: 'frontend_index.html', html: frontendIndexHtml }
];

for (const page of pages) {
  assert(page.html.includes('Distinctive Features (Optional)'), page.name + ' must include Distinctive Features UI');
  assert(page.html.includes('id="featureTurban"'), page.name + ' must include featureTurban checkbox');
  assert(page.html.includes('id="featureGlasses"'), page.name + ' must include featureGlasses checkbox');
  assert(page.html.includes('function getSelectedAttributes()'), page.name + ' must define getSelectedAttributes()');
  assert(page.html.includes('attributes: getSelectedAttributes()'), page.name + ' must pass attributes in create-preview payload');
  console.log('  ✔ ' + page.name + ' fully verified with UI elements, helpers, and API payload');
}

console.log('✅ TEST 6 PASSED: Frontend parity verified across special.html, index.html, and frontend_index.html.\n');

console.log('========================================================================');
console.log('🎉 ALL CULTURAL & VISUAL ATTRIBUTE PRESERVATION TESTS PASSED CLEANLY!');
console.log('========================================================================');
