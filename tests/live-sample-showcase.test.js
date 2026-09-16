const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('========================================================================');
console.log('🧪 TESTING LIVE BOOK SAMPLES SHOWCASE & OPTIMIZATION');
console.log('========================================================================');

// --- TEST 1: File Existence & Optimum Compression Verification ---
console.log('\n--- TEST 1: File Existence & Optimum Compression Verification ---');
const sampleFiles = [
  { file: 'sample-radha-cosmic-voyage.webp', maxKb: 350 },
  { file: 'sample-radha-cosmic-voyage.jpg', maxKb: 350 },
  { file: 'radha-starlight-cosmic-voyage-sample.pdf', maxKb: 2500 },
  { file: 'sample-sid-dinosaur-wonder.webp', maxKb: 350 },
  { file: 'sample-sid-dinosaur-wonder.jpg', maxKb: 350 },
  { file: 'sid-dinosaur-wonder-night-sample.pdf', maxKb: 2500 }
];

sampleFiles.forEach(({ file, maxKb }) => {
  const filePath = path.join(__dirname, '..', 'public', 'samples', file);
  assert(fs.existsSync(filePath), 'Missing expected sample file: ' + file);
  const stats = fs.statSync(filePath);
  const sizeKb = stats.size / 1024;
  console.log('  ✔ ' + file + ': ' + sizeKb.toFixed(1) + ' KB (within ' + maxKb + ' KB target)');
  assert(sizeKb <= maxKb, 'File ' + file + ' exceeds target size of ' + maxKb + ' KB: was ' + sizeKb + ' KB');
});
console.log('✅ TEST 1 PASSED: All 6 sample assets exist and meet compression targets.');

// --- TEST 2: HTML Integration & Elements ---
console.log('\n--- TEST 2: HTML Integration & UI Verification ---');
['index.html', 'frontend_index.html'].forEach((fileName) => {
  const htmlPath = path.join(__dirname, '..', fileName);
  const content = fs.readFileSync(htmlPath, 'utf8');

  assert(content.includes('id="previewShowcase"'), fileName + ' missing #previewShowcase');
  assert(content.includes("Radha's Starlight Cosmic Voyage"), fileName + ' missing Radha sample title');
  assert(content.includes("Sid's Dinosaur Wonder Night"), fileName + ' missing Sid sample title');
  assert(content.includes('/api/sample-download/radha'), fileName + ' missing Radha download route');
  assert(content.includes('/api/sample-download/sid'), fileName + ' missing Sid download route');
  assert(content.includes('switchBookSample'), fileName + ' missing switcher function');
  assert(content.includes('openSampleLightbox'), fileName + ' missing lightbox function');
  assert(content.includes('sampleLightboxModal'), fileName + ' missing lightbox modal');

  console.log('  ✔ ' + fileName + ': Showcase section, tabs, download routes, and lightbox verified.');
});
console.log('✅ TEST 2 PASSED: index.html and frontend_index.html properly configured.');

// --- TEST 3: special.html Isolation Constraint ---
console.log('\n--- TEST 3: special.html Isolation Constraint ---');
const specialHtml = fs.readFileSync(path.join(__dirname, '..', 'special.html'), 'utf8');
assert(!specialHtml.includes('sampleContentRadha'), 'special.html must NOT contain sampleContentRadha');
assert(!specialHtml.includes('sampleContentSid'), 'special.html must NOT contain sampleContentSid');
assert(!specialHtml.includes('/api/sample-download/radha'), 'special.html must NOT contain sample download routes');
console.log('  ✔ special.html is strictly untouched and does not include the showcase');
console.log('✅ TEST 3 PASSED: Isolation constraint honored.');

// --- TEST 4: Server Download Route Verification ---
console.log('\n--- TEST 4: Server Route & Header Inspection ---');
const serverContent = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert(serverContent.includes("app.get('/api/sample-download/:sampleId'"), 'server.js missing sample download route');
assert(serverContent.includes('radha-starlight-cosmic-voyage-sample.pdf'), 'server.js missing Radha PDF map');
assert(serverContent.includes('sid-dinosaur-wonder-night-sample.pdf'), 'server.js missing Sid PDF map');
assert(serverContent.includes('res.download('), 'server.js missing res.download attachment header');
console.log('  ✔ server.js has robust res.download route configured with custom attachment filenames.');
console.log('✅ TEST 4 PASSED: Server endpoints verified.');
// --- TEST 5: JavaScript Compilation & Syntax Audit ---
console.log('\n--- TEST 5: JavaScript Compilation & Syntax Audit ---');
const vm = require('vm');
['index.html', 'frontend_index.html'].forEach((fileName) => {
  const htmlPath = path.join(__dirname, '..', fileName);
  const content = fs.readFileSync(htmlPath, 'utf8');
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match, count = 0;
  while ((match = scriptRegex.exec(content)) !== null) {
    count++;
    const code = match[1];
    if (!code.trim()) continue;
    try {
      new vm.Script(code);
      console.log(`  ✔ ${fileName} Script #${count}: Parsed cleanly with zero syntax errors.`);
    } catch (err) {
      assert.fail(`${fileName} Script #${count} failed to parse: ${err.message}`);
    }
  }
});
console.log('✅ TEST 5 PASSED: All JavaScript scripts compile without syntax errors.');

// --- TEST 6: Simulated DOM Tab Switcher Execution ---
console.log('\n--- TEST 6: Simulated DOM Tab Switcher Execution ---');
function createMockElement(id, initialDisplay) {
  const classes = new Set();
  const attrs = {};
  return {
    id,
    style: { display: initialDisplay },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => attrs[k]
  };
}

const mockRadhaCard = createMockElement('sampleContentRadha', 'grid');
const mockSidCard = createMockElement('sampleContentSid', 'none');
const mockTabRadha = createMockElement('tabBtnRadha', '');
mockTabRadha.classList.add('active');
mockTabRadha.setAttribute('aria-selected', 'true');
const mockTabSid = createMockElement('tabBtnSid', '');
mockTabSid.setAttribute('aria-selected', 'false');

const elements = {
  sampleContentRadha: mockRadhaCard,
  sampleContentSid: mockSidCard,
  tabBtnRadha: mockTabRadha,
  tabBtnSid: mockTabSid
};

global.document = {
  getElementById: (id) => elements[id] || null
};

// Extract switchBookSample definition from index.html
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const switchFnMatch = indexHtml.match(/function switchBookSample\(sampleKey\)\s*\{[\s\S]*?\n    \}/);
assert(switchFnMatch, 'Could not find switchBookSample in index.html');
const switchFn = new Function('sampleKey', switchFnMatch[0].replace('function switchBookSample(sampleKey)', ''));

// Test switching to Sid (Sample 2)
switchFn('sid');
assert.strictEqual(mockRadhaCard.style.display, 'none', 'Radha card should be hidden');
assert.strictEqual(mockSidCard.style.display, 'grid', 'Sid card should be visible as grid');
assert(!mockTabRadha.classList.contains('active'), 'Radha tab should not be active');
assert(mockTabSid.classList.contains('active'), 'Sid tab should be active');
assert.strictEqual(mockTabSid.getAttribute('aria-selected'), 'true', 'Sid tab should have aria-selected=true');
assert.strictEqual(mockTabRadha.getAttribute('aria-selected'), 'false', 'Radha tab should have aria-selected=false');
console.log('  ✔ switchBookSample("sid"): Correctly switched to Sample 2 (Dinosaur Wonders)');

// Test switching back to Radha (Sample 1)
switchFn('radha');
assert.strictEqual(mockRadhaCard.style.display, 'grid', 'Radha card should be visible as grid');
assert.strictEqual(mockSidCard.style.display, 'none', 'Sid card should be hidden');
assert(mockTabRadha.classList.contains('active'), 'Radha tab should be active');
assert(!mockTabSid.classList.contains('active'), 'Sid tab should not be active');
console.log('  ✔ switchBookSample("radha"): Correctly switched back to Sample 1 (Space & Stars)');
console.log('✅ TEST 6 PASSED: Tab switching execution verified.');

console.log('\n========================================================================');
console.log('🎉 ALL LIVE BOOK SAMPLES SHOWCASE TESTS PASSED CLEANLY!');
console.log('========================================================================');
