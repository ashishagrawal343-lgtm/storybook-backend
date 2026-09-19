const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');

console.log('========================================================================');
console.log('🧪 TESTING GOOGLE CLOUD RUN SERVERLESS ENGINE DEPLOYMENT ARTIFACTS');
console.log('========================================================================\n');

// 1. Dockerfile configuration audit
console.log('--- TEST 1: Dockerfile Audit ---');
const dockerfilePath = path.join(__dirname, '..', 'Dockerfile');
assert.ok(fs.existsSync(dockerfilePath), 'Dockerfile must exist in project root');
const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');

assert.ok(dockerfileContent.includes('FROM node:22-bookworm-slim'), 'Dockerfile must use node:22-bookworm-slim base');
assert.ok(dockerfileContent.includes('fonts-dejavu-core'), 'Dockerfile must install font libraries');
assert.ok(dockerfileContent.includes('fontconfig'), 'Dockerfile must install fontconfig for Sharp rendering');
assert.ok(dockerfileContent.includes('ENV PORT=8080'), 'Dockerfile must specify default PORT 8080 for Cloud Run');
assert.ok(dockerfileContent.includes('engine-server.js'), 'Dockerfile CMD must run engine-server.js');
console.log('  ✔ Dockerfile base image: node:22-bookworm-slim');
console.log('  ✔ Dockerfile font packages: fontconfig, fonts-dejavu-core');
console.log('  ✔ Dockerfile Cloud Run port: 8080');
console.log('  ✔ Dockerfile entrypoint: CMD ["node", "--max-old-space-size=2048", "engine-server.js"]');
console.log('✅ TEST 1 PASSED: Dockerfile structure verified.\n');

// 2. .dockerignore audit
console.log('--- TEST 2: .dockerignore Audit ---');
const dockerignorePath = path.join(__dirname, '..', '.dockerignore');
assert.ok(fs.existsSync(dockerignorePath), '.dockerignore must exist in project root');
const dockerignoreContent = fs.readFileSync(dockerignorePath, 'utf8');

const ignoredPatterns = ['node_modules', 'books', '.git', '.env', 'tests'];
ignoredPatterns.forEach(pattern => {
    assert.ok(dockerignoreContent.includes(pattern), `.dockerignore must exclude ${pattern}`);
    console.log(`  ✔ Excludes: ${pattern}`);
});
console.log('✅ TEST 2 PASSED: .dockerignore excludes heavy/sensitive artifacts.\n');

// 3. Strict immutability constraint: server.js must NOT be modified
console.log('--- TEST 3: Strict Render Ecosystem Invariance Audit ---');
const { execSync } = require('child_process');
const gitDiffOutput = execSync('git diff HEAD -- server.js', { cwd: path.join(__dirname, '..') }).toString().trim();
assert.strictEqual(gitDiffOutput, '', 'server.js MUST BE 100% UNTOUCHED and invariant');
console.log('  ✔ server.js git diff against HEAD is completely empty (0 changes)');
console.log('✅ TEST 3 PASSED: Render ecosystem remains untouched.\n');

// 4. engine-server.js microservice audit
console.log('--- TEST 4: Engine Server Microservice Audit ---');
const engineServer = require('../engine-server');
assert.ok(engineServer, 'engine-server.js must export an Express application');

// Test running engine server on an ephemeral test port
const server = http.createServer(engineServer);
server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    console.log(`  ✔ Ephemeral test engine server started on port ${port}`);

    // Request GET /health
    http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
            try {
                assert.strictEqual(res.statusCode, 200, 'Health check must return HTTP 200');
                const data = JSON.parse(rawData);
                assert.strictEqual(data.status, 'ok', 'Health status must be "ok"');
                assert.strictEqual(data.service, 'storybook-engine', 'Service name must match "storybook-engine"');
                assert.ok(data.memory, 'Health check must report memory stats');
                console.log(`  ✔ GET /health returned 200 OK: ${JSON.stringify(data)}`);
                console.log('✅ TEST 4 PASSED: Engine microservice runs and responds properly.\n');

                server.close(() => {
                    console.log('========================================================================');
                    console.log('🎉 ALL CLOUD RUN ENGINE TESTS PASSED SUCCESSFULLY');
                    console.log('========================================================================');
                    process.exit(0);
                });
            } catch (err) {
                console.error('❌ Assertion failed:', err);
                server.close(() => process.exit(1));
            }
        });
    }).on('error', (e) => {
        console.error('❌ HTTP request failed:', e);
        server.close(() => process.exit(1));
    });
});
