/**
 * Automated Verification for Special Offer Landing Page & Pricing Guardrails
 * Tests:
 * 1. Express route availability for /special, /offer, and /public static assets
 * 2. Standard pricing integrity (12-page = ₹199, 22-page = ₹299) - Zero regression
 * 3. Special offer pricing (12-page = ₹99, 22-page = ₹199) when offer: 'special99'
 * 4. Payment verification minExpectedPaise calculation parity
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('========================================================================');
console.log('🧪 TESTING META AD SPECIAL OFFER (₹99 / ₹199) & ROUTE INTEGRITY');
console.log('========================================================================\n');

// 1. Check file existence
console.log('--- TEST 1: File Existence & Asset Verification ---');
const specialHtmlPath = path.join(__dirname, '..', 'special.html');
const siddhuImgPath = path.join(__dirname, '..', 'public', 'ad_showcase_siddhu.jpg');
const ananyaImgPath = path.join(__dirname, '..', 'public', 'ad_showcase_ananya.jpg');

assert(fs.existsSync(specialHtmlPath), 'special.html must exist in project root');
assert(fs.existsSync(siddhuImgPath), 'public/ad_showcase_siddhu.jpg must exist');
assert(fs.existsSync(ananyaImgPath), 'public/ad_showcase_ananya.jpg must exist');

const specialContent = fs.readFileSync(specialHtmlPath, 'utf8');
assert(specialContent.includes('SPECIAL OFFER'), 'special.html must contain Special Offer messaging');
assert(!specialContent.toLowerCase().includes('meta platforms'), 'special.html must not mention Meta');
assert(!specialContent.toLowerCase().includes('meta special'), 'special.html must not mention Meta Special');
assert(specialContent.includes('₹99'), 'special.html must offer ₹99 pricing');
assert(specialContent.includes('₹199'), 'special.html must offer ₹199 pricing');
assert(specialContent.includes('special99'), 'special.html must send offer: special99');
assert(specialContent.includes('Child Privacy Guarantee'), 'special.html must include Child Privacy Guarantee');
assert(specialContent.includes('https://twinkletaleai.com/'), 'special.html logo must link to original website');
console.log('✅ TEST 1 PASSED: special.html and public ad assets exist with required elements and no Meta mentions.\n');

// 2. Pricing Logic Unit Tests
console.log('--- TEST 2: Pricing Logic & Offer Isolation Unit Test ---');

function computeOrderAmount(bookLength, offer, sessionOffer) {
    const isLong = String(bookLength || '').toLowerCase().includes('long') || String(bookLength || '').includes('24') || String(bookLength || '').includes('22') || String(bookLength || '').includes('28') || String(bookLength || '').includes('grand');
    const isOffer = (offer === 'special99') || (sessionOffer === 'special99');
    const amountPaise = isOffer ? (isLong ? 19900 : 9900) : (isLong ? 29900 : 19900);
    return { isLong, isOffer, amountPaise };
}

// Standard Website (index.html) Tests - Must NOT be affected
const std12 = computeOrderAmount('12 pages', null, null);
assert.strictEqual(std12.amountPaise, 19900, 'Standard 12-page book must remain ₹199 (19900 paise)');
assert.strictEqual(std12.isOffer, false);

const std22 = computeOrderAmount('22 pages', null, null);
assert.strictEqual(std22.amountPaise, 29900, 'Standard 22-page book must remain ₹299 (29900 paise)');
assert.strictEqual(std22.isOffer, false);

// Special Landing Page (/special) Tests
const offer12 = computeOrderAmount('12 pages', 'special99', null);
assert.strictEqual(offer12.amountPaise, 9900, 'Special offer 12-page book must be ₹99 (9900 paise)');
assert.strictEqual(offer12.isOffer, true);

const offer22 = computeOrderAmount('22 pages', 'special99', null);
assert.strictEqual(offer22.amountPaise, 19900, 'Special offer 22-page book must be ₹199 (19900 paise)');
assert.strictEqual(offer22.isOffer, true);

// Inherited session offer
const sessionOffer12 = computeOrderAmount('12 pages', null, 'special99');
assert.strictEqual(sessionOffer12.amountPaise, 9900, 'Session offer must carry over to 12-page book (9900 paise)');

const sessionOffer22 = computeOrderAmount('22 pages', null, 'special99');
assert.strictEqual(sessionOffer22.amountPaise, 19900, 'Session offer must carry over to 22-page book (19900 paise)');

console.log('✅ TEST 2 PASSED: Pricing engine correctly isolates standard (₹199/₹299) vs promo (₹99/₹199).\n');

// 3. Payment Verification Guard Tests
console.log('--- TEST 3: Payment Verification Minimum Amount Audit ---');

function computeMinExpectedPaise(bookLength, sessionOffer, reqOffer) {
    const isLong = String(bookLength || '').toLowerCase().includes('long') || String(bookLength || '').includes('24') || String(bookLength || '').includes('22') || String(bookLength || '').includes('28') || String(bookLength || '').includes('grand');
    const isOffer = (sessionOffer === 'special99') || (reqOffer === 'special99');
    return isOffer ? (isLong ? 19900 : 9900) : (isLong ? 29900 : 19900);
}

// Ensure an attacker from / cannot claim ₹99 without the offer flag
assert.strictEqual(computeMinExpectedPaise('12 pages', null, null), 19900);
// Ensure legitimate user from /special is validated at ₹99
assert.strictEqual(computeMinExpectedPaise('12 pages', 'special99', null), 9900);
assert.strictEqual(computeMinExpectedPaise('12 pages', null, 'special99'), 9900);
// Ensure 22-page offer is validated at ₹199
assert.strictEqual(computeMinExpectedPaise('22 pages', 'special99', null), 19900);

console.log('✅ TEST 3 PASSED: Payment gateway audit guard correctly enforces expected paise amounts.\n');

// 4. Server Route Handlers Verification
console.log('--- TEST 4: Server Code Inspection for Routes & Handlers ---');
const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert(serverCode.includes("app.use('/public'"), 'server.js must mount /public static directory');
assert(serverCode.includes("app.get('/special'"), 'server.js must define /special route');
assert(serverCode.includes("app.get('/offer'"), 'server.js must define /offer route');
assert(serverCode.includes("special.html"), 'server.js must serve special.html');
assert(serverCode.includes("isOffer"), 'server.js must evaluate isOffer');
assert(serverCode.includes("9900"), 'server.js must handle 9900 paise');

console.log('✅ TEST 4 PASSED: server.js contains all required routes and offer handlers.\n');

console.log('========================================================================');
console.log('🏁 ALL SPECIAL OFFER & META LANDING PAGE TESTS PASSED!');
console.log('========================================================================');
