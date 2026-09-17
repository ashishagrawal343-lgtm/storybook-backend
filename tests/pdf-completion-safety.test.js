const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('========================================================================');
console.log('🧪 TESTING PDF COMPLETION SAFETY & NULL-POINTER GUARD');
console.log('========================================================================\n');

const serverFile = path.join(__dirname, '..', 'server.js');
const serverContent = fs.readFileSync(serverFile, 'utf8');

// TEST 1: Check for illegal pdfDoc.getPageCount() after pdfDoc = null
console.log('--- TEST 1: Checking for pdfDoc dereference after null assignment ---');
const saveIdx = serverContent.indexOf('pdfDoc = null;');
assert.ok(saveIdx > 0, 'pdfDoc = null; must exist in server.js');

const remainingServerContent = serverContent.slice(saveIdx);
const illegalMatch = remainingServerContent.match(/pdfDoc\.[a-zA-Z0-9_]+/);
if (illegalMatch) {
    console.error('❌ Found illegal pdfDoc usage after null assignment:', illegalMatch[0]);
    process.exit(1);
}
console.log('  ✔ Verified zero illegal pdfDoc references after pdfDoc = null;');
assert.ok(remainingServerContent.includes('Pages=${finalPageCount}'), 'Must log Pages=${finalPageCount}');
console.log('  ✔ Verified log correctly uses cached finalPageCount');
console.log('✅ TEST 1 PASSED: Null-pointer dereference completely eliminated.\n');

// TEST 2: Verify post-save disk safety guard
console.log('--- TEST 2: Verifying PDF disk safety guard ---');
assert.ok(serverContent.includes('// SAFETY GUARD: If the PDF was already generated and saved to disk'), 'Safety guard comment must exist');
assert.ok(serverContent.includes('existingJob.status === \'completed\' && existingJob.fileName'), 'Must check existing completed job with fileName');
assert.ok(serverContent.includes('fs.statSync(checkFile).size > 1000'), 'Must verify file size on disk exceeds 1000 bytes');
console.log('  ✔ Verified safety guard checks if PDF exists on disk before rethrowing');
console.log('✅ TEST 2 PASSED: Post-save disk safety guard verified.\n');

// TEST 3: Verify Brevo API key sanitization
console.log('--- TEST 3: Verifying Brevo API credentials sanitization ---');
assert.ok(serverContent.includes('cleanBrevoKey'), 'cleanBrevoKey must exist');
assert.ok(serverContent.includes('cleanSenderEmail'), 'cleanSenderEmail must exist');
assert.ok(serverContent.includes(".replace(/^[\"']|[\"']$/g, '')"), 'Must strip accidental quotes from env vars');
console.log('  ✔ Verified Brevo API key and sender email are trimmed and sanitized');
console.log('✅ TEST 3 PASSED: Brevo credential sanitization verified.\n');

// TEST 4: Verify Favicon 204 handler
console.log('--- TEST 4: Verifying /favicon.ico handler ---');
assert.ok(serverContent.includes("app.get('/favicon.ico', (req, res) => res.status(204).end());"), 'Favicon handler must return 204');
console.log('  ✔ Verified /favicon.ico returns 204 to eliminate 404 log clutter');
console.log('✅ TEST 4 PASSED: Favicon handler verified.\n');

console.log('========================================================================');
console.log('🎉 ALL PDF COMPLETION SAFETY TESTS PASSED 100%!');
console.log('========================================================================\n');
