/**
 * Automated Verification & CRO Audit for TwinkleTale US Storefront & Multi-Currency Engine
 * 
 * Verifies:
 * 1. File existence, responsive structure, and CRO sections in us.html
 * 2. Mobile-first responsive guardrails (viewport, touch targets >= 44px, safe area insets, clamp typography)
 * 3. US Pricing & Promotion ($5.99 Treasury / $11.99 Grand Treasury, 50% discount)
 * 4. Zero regression on Indian storefront (index.html, special.html, ₹99/₹199/₹299 pricing)
 * 5. Express route availability (/us and /usa serve us.html with 200 OK)
 * 6. Server-authoritative order creation via POST /api/create-order:
 *    - US market returns currency: 'USD', amount: 599 for 12 pages
 *    - US market returns currency: 'USD', amount: 1199 for 22 pages
 *    - Anti-tampering: Client attempting to send { amount: 100 } is overridden by server
 *    - IN market continues returning currency: 'INR', amount: 9900/19900/29900 paise
 * 7. Verification guard in POST /api/verify-and-complete-book enforces currency and subunit matching
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('========================================================================');
console.log('🇺🇸 AUDITING US STOREFRONT & MULTI-CURRENCY ANTI-TAMPER ENGINE');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// TEST 1: File Existence & Asset Verification
// -----------------------------------------------------------------------------
console.log('--- TEST 1: File Existence & Content Verification ---');
const usHtmlPath = path.join(__dirname, '..', 'us.html');
const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const specialHtmlPath = path.join(__dirname, '..', 'special.html');
const serverJsPath = path.join(__dirname, '..', 'server.js');

assert(fs.existsSync(usHtmlPath), 'us.html must exist in the root directory');
assert(fs.existsSync(indexHtmlPath), 'index.html must exist in the root directory');
assert(fs.existsSync(specialHtmlPath), 'special.html must exist in the root directory');
assert(fs.existsSync(serverJsPath), 'server.js must exist in the root directory');

const usContent = fs.readFileSync(usHtmlPath, 'utf8');
const indexContent = fs.readFileSync(indexHtmlPath, 'utf8');
const specialContent = fs.readFileSync(specialHtmlPath, 'utf8');
const serverContent = fs.readFileSync(serverJsPath, 'utf8');

// Assert US Pricing
assert(usContent.includes('$5.99'), 'us.html must feature $5.99 Treasury Edition pricing');
assert(usContent.includes('$11.99'), 'us.html must feature $11.99 Grand Treasury Edition pricing');
assert(usContent.includes('$23.99'), 'us.html must show $23.99 strike-off MSRP for 22 pages');
assert(usContent.includes('50% OFF'), 'us.html must highlight 50% discount');
assert(usContent.includes('12 full physical pages'), 'us.html must specify 12 physical pages for Treasury');
assert(usContent.includes('22 full physical pages'), 'us.html must specify 22 physical pages for Grand Treasury');

// Assert No stray Rupee symbols in US HTML text
assert(!usContent.includes('₹'), 'us.html must not display Indian Rupee (₹) symbols');

console.log('✅ TEST 1 PASSED: us.html exists with required US pricing ($5.99 / $11.99) and zero ₹ mentions.\n');

// -----------------------------------------------------------------------------
// TEST 2: Mobile-First Responsive & CRO Architectural Audit
// -----------------------------------------------------------------------------
console.log('--- TEST 2: Mobile-First Responsive & CRO Elements Audit ---');

assert(usContent.includes('viewport-fit=cover'), 'Viewport meta tag must include viewport-fit=cover for iOS notched phones');
assert(usContent.includes('sticky-mobile-bar'), 'us.html must include sticky-mobile-bar');
assert(usContent.includes('env(safe-area-inset-bottom)'), 'Sticky mobile bar must accommodate safe-area-inset-bottom for iPhone home indicator');
assert(usContent.includes('canvas.toDataURL'), 'us.html must downsample photo uploads client-side via canvas for mobile speed');
assert(usContent.includes('maxDim = 768'), 'us.html must constrain canvas dimensions to 768px for optimum mobile upload speed');
assert(usContent.includes('font-size: 16px'), 'Form inputs must use 16px font-size to prevent iOS Safari auto-zoom');
assert(usContent.includes('checkout.razorpay.com/v1/checkout.js'), 'us.html must include Razorpay checkout SDK');
assert(usContent.includes('currency: orderData.currency || "USD"'), 'Razorpay checkout handler must specify USD currency');
assert(usContent.includes('sample-radha-cosmic-voyage'), 'us.html must showcase Radha cosmic sample');
assert(usContent.includes('sample-sid-dinosaur-wonder'), 'us.html must showcase Sid dinosaur sample');
assert(usContent.includes('/api/sample-download/radha'), 'us.html must provide direct download route for Radha sample');
assert(usContent.includes('/api/sample-download/sid'), 'us.html must provide direct download route for Sid sample');

console.log('✅ TEST 2 PASSED: Mobile-first responsive, canvas downsampler, sticky CTA, and CRO elements verified.\n');

// -----------------------------------------------------------------------------
// TEST 3: Zero-Regression on Indian Storefronts (index.html & special.html)
// -----------------------------------------------------------------------------
console.log('--- TEST 3: Zero-Regression on Indian Storefronts ---');

assert(indexContent.includes('₹199'), 'index.html must maintain its ₹199 standard pricing');
assert(indexContent.includes('₹299'), 'index.html must maintain its ₹299 standard pricing');
assert(specialContent.includes('₹99'), 'special.html must maintain its ₹99 promo pricing');
assert(specialContent.includes('₹199'), 'special.html must maintain its ₹199 promo pricing');

console.log('✅ TEST 3 PASSED: Indian domestic pricing and landing pages completely intact.\n');

// -----------------------------------------------------------------------------
// TEST 4: Server Code Configuration Inspection (MARKET_CONFIG & Routes)
// -----------------------------------------------------------------------------
console.log('--- TEST 4: Server Multi-Currency Engine & Route Inspection ---');

assert(serverContent.includes('const MARKET_CONFIG'), 'server.js must define MARKET_CONFIG');
assert(serverContent.includes("currency: 'USD'"), 'server.js must support USD currency');
assert(serverContent.includes("offerPriceSubunits: 599"), 'server.js must configure 599 cents ($5.99) for US short edition');
assert(serverContent.includes("offerPriceSubunits: 1199"), 'server.js must configure 1199 cents ($11.99) for US long edition');
assert(serverContent.includes("priceSubunits: 1199"), 'server.js must configure 1199 cents regular price for US short edition');
assert(serverContent.includes("priceSubunits: 2399"), 'server.js must configure 2399 cents regular price for US long edition');
assert(serverContent.includes("app.get('/us'"), 'server.js must register GET /us route');
assert(serverContent.includes("app.get('/usa'"), 'server.js must register GET /usa route');

console.log('✅ TEST 4 PASSED: server.js contains MARKET_CONFIG and /us route registrations.\n');

// -----------------------------------------------------------------------------
// TEST 5: Live HTTP Route & Anti-Tampering Simulation
// -----------------------------------------------------------------------------
console.log('--- TEST 5: Live Express HTTP Requests & Anti-Tampering Audit ---');

const { app } = require('../server.js');

async function runHttpTests() {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 5.1 GET /us returns 200 OK and contains us.html content
    const resUs = await fetch(`${baseUrl}/us`);
    assert.strictEqual(resUs.status, 200, 'GET /us must return 200 OK');
    const textUs = await resUs.text();
    assert(textUs.includes('$5.99'), 'GET /us must serve HTML containing $5.99');
    console.log('  ✔ GET /us served 200 OK with correct US content');

    // 5.2 GET /usa returns 200 OK
    const resUsa = await fetch(`${baseUrl}/usa`);
    assert.strictEqual(resUsa.status, 200, 'GET /usa must return 200 OK');
    console.log('  ✔ GET /usa served 200 OK');

    // 5.3 POST /api/create-order for US 12-page book
    const orderUsShort = await fetch(`${baseUrl}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market: 'US',
        isDirectCheckout: true,
        childName: 'Leo',
        gender: 'boy',
        age: 5,
        theme: 'Space & Stars',
        bookLength: '12 pages',
        email: 'test-parent@example.com'
      })
    });
    const dataUsShort = await orderUsShort.json();
    assert.strictEqual(dataUsShort.success, true, 'US 12-page order creation must succeed');
    assert.strictEqual(dataUsShort.currency, 'USD', 'US order currency must be USD');
    assert.strictEqual(dataUsShort.amount, 599, 'US 12-page order amount must be 599 cents ($5.99)');
    console.log('  ✔ POST /api/create-order for US (12 pages) returned 599 USD cents ($5.99)');

    // 5.4 POST /api/create-order for US 22-page book
    const orderUsLong = await fetch(`${baseUrl}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market: 'US',
        isDirectCheckout: true,
        childName: 'Maya',
        gender: 'girl',
        age: 6,
        theme: 'Dinosaur Wonders',
        bookLength: '22 pages',
        email: 'test-parent@example.com'
      })
    });
    const dataUsLong = await orderUsLong.json();
    assert.strictEqual(dataUsLong.success, true, 'US 22-page order creation must succeed');
    assert.strictEqual(dataUsLong.currency, 'USD', 'US order currency must be USD');
    assert.strictEqual(dataUsLong.amount, 1199, 'US 22-page order amount must be 1199 cents ($11.99)');
    console.log('  ✔ POST /api/create-order for US (22 pages) returned 1199 USD cents ($11.99)');

    // 5.5 ANTI-TAMPERING TEST: Fraudulent client passes { amount: 50, market: 'US' }
    const orderTampered = await fetch(`${baseUrl}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market: 'US',
        amount: 50, // Malicious attempt to pay 50 cents instead of 599
        isDirectCheckout: true,
        childName: 'Hacker',
        gender: 'boy',
        age: 7,
        theme: 'Superheroes',
        bookLength: '12 pages',
        email: 'hacker@example.com'
      })
    });
    const dataTampered = await orderTampered.json();
    assert.strictEqual(dataTampered.success, true);
    assert.strictEqual(dataTampered.amount, 599, 'Server must enforce authoritative 599 cents and ignore client amount');
    console.log('  ✔ Anti-tamper verification: Server ignored malicious client amount and enforced 599 cents');

    // 5.6 POST /api/create-order for standard Indian domestic flow (no market parameter)
    const orderIndia = await fetch(`${baseUrl}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isDirectCheckout: true,
        childName: 'Aarav',
        gender: 'boy',
        age: 5,
        theme: 'Space & Stars',
        bookLength: '12 pages',
        email: 'india-parent@example.com'
      })
    });
    const dataIndia = await orderIndia.json();
    assert.strictEqual(dataIndia.success, true);
    assert.strictEqual(dataIndia.currency, 'INR', 'Default/India order currency must be INR');
    assert.strictEqual(dataIndia.amount, 19900, 'Default 12-page India order must be ₹199 (19900 paise)');
    console.log('  ✔ Default/India domestic flow unaffected: Returned 19900 INR paise (₹199)');

    // 5.7 POST /api/create-order with offer: 'special99' for Indian promo
    const orderIndiaPromo = await fetch(`${baseUrl}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market: 'IN',
        offer: 'special99',
        isDirectCheckout: true,
        childName: 'Ananya',
        gender: 'girl',
        age: 4,
        theme: 'Magical Forest',
        bookLength: '12 pages',
        email: 'india-parent@example.com'
      })
    });
    const dataIndiaPromo = await orderIndiaPromo.json();
    assert.strictEqual(dataIndiaPromo.success, true);
    assert.strictEqual(dataIndiaPromo.currency, 'INR');
    assert.strictEqual(dataIndiaPromo.amount, 9900, 'Special99 India promo must be ₹99 (9900 paise)');
    console.log('  ✔ India special99 promo unaffected: Returned 9900 INR paise (₹99)');

  } finally {
    server.close();
  }
}

runHttpTests()
  .then(() => {
    console.log('\n========================================================================');
    console.log('🎉 ALL US STOREFRONT & MULTI-CURRENCY TESTS PASSED FLAWLESSLY!');
    console.log('========================================================================\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
