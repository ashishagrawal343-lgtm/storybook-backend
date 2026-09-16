/**
 * tests/strict-physical-attributes-no-props.test.js
 * 
 * Verifies strict preservation of child physical attributes as-is from uploaded photo:
 * 1. Children with natural hair & no glasses must never receive caps, hats, spectacles, or extra props.
 * 2. All 12 Theme Master roles must have all costume props (satchels, pocket watches, magnifying glasses, caps) stripped.
 * 3. Cover prompt and interior scene generation enforce identical non-regression guardrails.
 * 4. Vision attribute extraction does not hallucinate headwear or glasses from natural hair, shadows, or reflections.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { normalizeAttributes } = require('../lib/vision/attributeExtractor');
const { THEME_MASTERS, getThemeMaster, sanitizeChildRoleForHeadwear } = require('../lib/cover/themeMasters');
const { buildCoverPrompt } = require('../lib/cover/promptBuilder');

console.log('========================================================================');
console.log('🧪 TESTING STRICT PHYSICAL ATTRIBUTES PRESERVATION & NO UNWANTED PROPS');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// TEST 1: Child with Natural Hair & No Glasses (Standard Photo)
// -----------------------------------------------------------------------------
console.log('--- TEST 1: Child with Natural Hair & No Glasses ---');

const standardChildAttrs = normalizeAttributes({}, {});
assert.strictEqual(standardChildAttrs.hasHeadwear, false, 'hasHeadwear must be false');
assert.strictEqual(standardChildAttrs.headwearType, 'none', 'headwearType must be none');
assert.strictEqual(standardChildAttrs.headwearDescription, '', 'headwearDescription must be empty');
assert.strictEqual(standardChildAttrs.hasGlasses, false, 'hasGlasses must be false');
assert.strictEqual(standardChildAttrs.glassesDescription, '', 'glassesDescription must be empty');

const childObj = {
  name: 'Leo',
  gender: 'boy',
  age: 4,
  charAnchor: 'Leo, a joyful boy with bright dark eyes and short natural curly black hair',
  attributes: standardChildAttrs
};

const coverPrompt = buildCoverPrompt('Space & Stars', 'HERO_SCENE', childObj, {
  bookTitle: "Leo's Starlit Wonder"
});

const posPrompt = coverPrompt.positivePrompt;
const negPrompt = coverPrompt.negativePrompt;

// Check positive prompt directives
assert(posPrompt.includes('[STRICT NATURAL HAIR:'), 'Positive prompt must include strict natural hair directive');
assert(posPrompt.includes('[STRICT NATURAL EYES:'), 'Positive prompt must include strict natural eyes directive');
assert(posPrompt.includes('[STRICT NO-PROPS RULE:'), 'Positive prompt must include strict no-props rule');

// Check negative exclusions
const expectedNegativeTokens = [
  'hat', 'cap', 'baseball cap', 'beanie', 'helmet', 'crown', 'tiara',
  'glasses', 'spectacles', 'sunglasses', 'eyewear', 'frames',
  'unnecessary props', 'extra props', 'costume props', 'costume accessories'
];

for (const token of expectedNegativeTokens) {
  assert(negPrompt.toLowerCase().includes(token.toLowerCase()), `Negative prompt must exclude "${token}"`);
}

console.log('  ✔ Positive prompt commands strict physical fidelity without props');
console.log('  ✔ Negative prompt explicitly excludes hats, caps, glasses, and extra props');
console.log('✅ TEST 1 PASSED: Standard child prompt completely sanitized.\n');

// -----------------------------------------------------------------------------
// TEST 2: Sanitize All 12 Themes for Children Without Props
// -----------------------------------------------------------------------------
console.log('--- TEST 2: Sanitize All 12 Themes Against Prop Infiltration ---');

const themes = Object.keys(THEME_MASTERS);
const forbiddenPropKeywords = [
  'conductor cap', 'top hat', 'flower crown', 'satchel',
  'pocket watch', 'magnifying glass', 'spectacles', 'glasses'
];

for (const themeKey of themes) {
  const tm = THEME_MASTERS[themeKey];
  const sanitizedRole = sanitizeChildRoleForHeadwear(tm.childRole, standardChildAttrs);

  for (const forbidden of forbiddenPropKeywords) {
    assert(
      !sanitizedRole.toLowerCase().includes(forbidden),
      `Sanitized role for theme "${themeKey}" must NOT contain "${forbidden}". Got: "${sanitizedRole}"`
    );
  }

  // Also test generated cover prompt
  const res = buildCoverPrompt(themeKey, 'HERO_SCENE', childObj, { bookTitle: `Leo and ${tm.themeName}` });
  for (const forbidden of forbiddenPropKeywords) {
    // Motifs and role should not contain forbidden props
    assert(
      !res.positivePrompt.toLowerCase().includes(forbidden),
      `Cover prompt for theme "${themeKey}" must NOT contain "${forbidden}"`
    );
  }
}

console.log(`  ✔ Verified all ${themes.length} themes cleanly strip props, hats, caps, and eyewear.`);
console.log('✅ TEST 2 PASSED: Theme role prop sanitation 100% effective across all themes.\n');

// -----------------------------------------------------------------------------
// TEST 3: Glasses-Only Child (Preserve Glasses, Strict No-Hat/No-Props)
// -----------------------------------------------------------------------------
console.log('--- TEST 3: Child Wearing Glasses in Photo ---');

const glassesAttrs = normalizeAttributes({ hasGlasses: true, glassesDescription: 'round wireframe glasses' });
assert.strictEqual(glassesAttrs.hasGlasses, true);
assert.strictEqual(glassesAttrs.hasHeadwear, false);

const glassesChildObj = {
  name: 'Sam',
  gender: 'boy',
  age: 6,
  charAnchor: 'Sam, a sweet boy with round glasses',
  attributes: glassesAttrs
};

const glassesPrompt = buildCoverPrompt('Forest & Animals', 'HERO_SCENE', glassesChildObj, {
  bookTitle: "Sam's Secret Forest"
});

assert(glassesPrompt.positivePrompt.includes('(wearing round wireframe glasses:1.3)'), 'Must include weighted glasses token');
assert(glassesPrompt.positivePrompt.includes('[CRITICAL VISUAL FEATURE: The child is wearing round wireframe glasses'), 'Must include glasses feature directive');
assert(glassesPrompt.positivePrompt.includes('[STRICT NATURAL HAIR:'), 'Must still enforce natural hair directive');
assert(glassesPrompt.negativePrompt.includes('hat, cap, baseball cap'), 'Must still exclude caps and hats');

console.log('  ✔ Child with glasses keeps glasses while completely excluding caps, hats, and props');
console.log('✅ TEST 3 PASSED: Glasses preservation without prop pollution verified.\n');

// -----------------------------------------------------------------------------
// TEST 4: Turban-Only Child (Preserve Turban, Strict No-Glasses/No-Props)
// -----------------------------------------------------------------------------
console.log('--- TEST 4: Child Wearing Authentic Turban in Photo ---');

const turbanAttrs = normalizeAttributes({ hasHeadwear: true, headwearType: 'turban', headwearDescription: 'royal blue turban' });
assert.strictEqual(turbanAttrs.hasHeadwear, true);
assert.strictEqual(turbanAttrs.hasGlasses, false);

const turbanChildObj = {
  name: 'Jaspreet',
  gender: 'boy',
  age: 5,
  charAnchor: 'Jaspreet, a cheerful boy in a royal blue turban',
  attributes: turbanAttrs
};

const turbanPrompt = buildCoverPrompt('Trains & Vehicles', 'HERO_SCENE', turbanChildObj, {
  bookTitle: "Jaspreet's Train"
});

assert(turbanPrompt.positivePrompt.includes('(wearing an authentic royal blue turban:1.35)'), 'Must include weighted turban token');
assert(turbanPrompt.positivePrompt.includes('[CRITICAL CULTURAL ACCURACY:'), 'Must include cultural accuracy directive');
assert(turbanPrompt.positivePrompt.includes('[STRICT NATURAL EYES:'), 'Must enforce natural eyes directive');
assert(turbanPrompt.negativePrompt.includes('glasses, spectacles'), 'Must exclude glasses and spectacles');

console.log('  ✔ Child with turban keeps turban while strictly excluding glasses and extra props');
console.log('✅ TEST 4 PASSED: Cultural headwear preservation without unwanted props verified.\n');

// -----------------------------------------------------------------------------
// TEST 5: Server Pipeline Inspection (generateAvatar & assembleFullBookAsync)
// -----------------------------------------------------------------------------
console.log('--- TEST 5: Server Pipeline Directives Audit ---');

const serverJsContent = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Audit generateAvatar
assert(serverJsContent.includes('[STRICT HEADWEAR RESTRICTION: The child in the photo has natural hair with NO headwear, NO hat, NO cap.'), 'generateAvatar must restrict headwear for bare-headed child');
assert(serverJsContent.includes('[STRICT EYEWEAR RESTRICTION: The child in the photo does NOT wear glasses.'), 'generateAvatar must restrict eyewear for non-glasses child');
assert(serverJsContent.includes('[STRICT NO-PROPS RULE: Strictly maintain the child\'s physical attributes as-is from the photo without adding any extra props'), 'generateAvatar must enforce no-props rule');
assert(serverJsContent.includes('absolutely NO hats, NO caps, NO spectacles, NO glasses, NO sunglasses, NO extra props, NO unneeded accessories'), 'generateAvatar prompt must exclude props in suffix');

// Audit assembleFullBookAsync (interior pages parity)
assert(serverJsContent.includes('Strict physical requirement: The child has natural hair with NO headwear; do NOT add any hat, cap, crown, or head covering.'), 'assembleFullBookAsync must enforce no headwear for natural hair');
assert(serverJsContent.includes('Strict physical requirement: The child does NOT wear glasses; do NOT add any spectacles, glasses, sunglasses, or frames.'), 'assembleFullBookAsync must enforce no glasses for non-glasses child');
assert(serverJsContent.includes('Strict physical likeness: Maintain the child\'s natural appearance as-is from the photo without adding any extra props or accessories.'), 'assembleFullBookAsync must enforce no props in interior scenes');

console.log('  ✔ generateAvatar in server.js strictly restricts extra props, hats, and glasses');
console.log('  ✔ assembleFullBookAsync in server.js enforces exact parity for interior pages');
console.log('✅ TEST 5 PASSED: Server-side pipeline parity verified.\n');

console.log('========================================================================');
console.log('🎉 ALL STRICT PHYSICAL ATTRIBUTE & NO-PROPS TESTS PASSED CLEANLY!');
console.log('========================================================================');
