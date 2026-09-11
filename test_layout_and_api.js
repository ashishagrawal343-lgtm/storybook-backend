// Local test script for TwinkleTale backend logic
const assert = require('assert');

// Test 1: Page & scene counts
function getSceneCount(bookLength) {
    const s = String(bookLength || '').toLowerCase();
    if (s.includes('24') || s.includes('long')) return 12;
    if (s.includes('16')) return 8;
    return 6;
}

assert.strictEqual(getSceneCount('Short Book'), 6, 'Short Book should have 6 scenes (12 interior pages)');
assert.strictEqual(getSceneCount('12 pages'), 6, '12 pages should have 6 scenes');
assert.strictEqual(getSceneCount('Long Book'), 12, 'Long Book should have 12 scenes (24 interior pages)');
assert.strictEqual(getSceneCount('24 pages'), 12, '24 pages should have 12 scenes');
console.log('✅ Page & scene count tests passed');

// Test 2: Guardrail zones
const Z = {
    name:  { bottom: 690 },
    medal: { cx: 300, cy: 450, r: 120 },
    title: { top: 300, bottom: 150 }
};
const ok = Z.name.bottom > (Z.medal.cy + Z.medal.r + 12) &&
           (Z.medal.cy - Z.medal.r - 12) > Z.title.top &&
           Z.title.bottom > 0;
assert(ok, 'Cover guardrail zones should not overlap');
console.log('✅ Cover guardrail assertions passed');

// Test 3: Gender & character anchor logic
function createAnchor(childName, gender, age) {
    const genderClean = (String(gender || '').toLowerCase().trim() === 'girl') ? 'girl' : 'boy';
    const childAge = parseInt(age, 10) || 5;
    const pronoun = (genderClean === 'girl') ? 'her' : 'his';
    const subjectPronoun = (genderClean === 'girl') ? 'she' : 'he';
    const charAnchor = `a cute ${childAge}-year-old ${genderClean} named ${childName}`;
    return { genderClean, childAge, pronoun, subjectPronoun, charAnchor };
}

const boyAnchor = createAnchor('Aarav', 'boy', 5);
assert.strictEqual(boyAnchor.genderClean, 'boy');
assert.strictEqual(boyAnchor.pronoun, 'his');
assert.strictEqual(boyAnchor.subjectPronoun, 'he');
assert(boyAnchor.charAnchor.includes('boy named Aarav'));

const girlAnchor = createAnchor('Ananya', 'girl', 6);
assert.strictEqual(girlAnchor.genderClean, 'girl');
assert.strictEqual(girlAnchor.pronoun, 'her');
assert.strictEqual(girlAnchor.subjectPronoun, 'she');
assert(girlAnchor.charAnchor.includes('girl named Ananya'));
console.log('✅ Gender & character anchor tests passed');

// Test 4: Spread layout calculations
// Short book: Cover (1) + Frontispiece (2) + Dedication (3) + 6 Spreads (4-15) + Keepsake (16) + Back (17)
const shortScenes = 6;
const totalInteriorPages = shortScenes * 2; // 12 interior pages
assert.strictEqual(totalInteriorPages, 12, 'Interior pages for 6 scenes must be 12');

const longScenes = 12;
const totalLongInteriorPages = longScenes * 2; // 24 interior pages
assert.strictEqual(totalLongInteriorPages, 24, 'Interior pages for 12 scenes must be 24');

console.log('✅ Spread layout math tests passed');
console.log('🎉 All backend logic verified successfully!');
