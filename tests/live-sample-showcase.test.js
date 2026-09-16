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

console.log('\n========================================================================');
console.log('🎉 ALL LIVE BOOK SAMPLES SHOWCASE TESTS PASSED CLEANLY!');
console.log('========================================================================');
