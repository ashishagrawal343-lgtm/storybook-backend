const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('========================================================================');
console.log('🧪 TESTING CHARACTER IDENTITY PARITY & WARDROBE CONSISTENCY');
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

console.log('\n--- TEST 3: Prompt Enforces 80-90% Likeness and Signature Outfit ---');
assert(
    serverSource.includes('preserving 80-90% facial likeness and identity: identical facial structure, eye shape, eyebrows, nose, mouth, authentic cheerful smile, natural skin tone, hair texture, and consistently ${activeOutfit}'),
    'Scene prompt must mandate 80-90% facial likeness, facial structure, eye shape, nose, mouth, smile, skin tone, hair texture, and consistent outfit'
);
assert(
    serverSource.includes('generateImage(scenePrompt, visualCondition, { isFace: true })'),
    'generateImage must receive visualCondition (photoData) directly for interior scene illustration'
);
console.log('✅ TEST 3 PASSED: Scene prompts enforce 80-90% likeness, facial structure, and signature outfit');

console.log('\n--- TEST 4: Direct Checkout Bedtime Story Authoring Prompt Includes Outfit ---');
assert(
    serverSource.includes('Character signature outfit: ${activeOutfit}. Language: ${language}.'),
    'Authoring LLM prompt must specify signature outfit'
);
console.log('✅ TEST 4 PASSED: Authoring LLM prompt includes signature outfit');

console.log('\n========================================================================');
console.log('🏁 ALL CHARACTER IDENTITY PARITY & WARDROBE TESTS PASSED!');
console.log('========================================================================\n');
