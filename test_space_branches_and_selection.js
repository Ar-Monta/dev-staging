import http from 'http';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runAudit() {
  console.log('=== AUDIT: EDIT WHOLE SPACE BRANCHES & CHOOSE TENANTS ===\n');

  // Reset all first
  await request('POST', '/api/reset');

  // Test 1: Edit whole space branches for stage_sekkat
  console.log('[Test 1] POST /api/space-branches: Edit branches for stage_sekkat');
  const res1 = await request('POST', '/api/space-branches', {
    spaceId: 'stage_sekkat',
    branches: {
      frontend: 'feat/space-fe-v1',
      backend: 'feat/space-be-v1',
      crm: 'feat/space-crm-v1'
    },
    userName: 'Admin'
  });
  if (res1.status !== 200) throw new Error(`Test 1 failed: ${JSON.stringify(res1)}`);
  console.log('✓ Space branches updated:', res1.data.space.branches);

  // Test 2: Occupy CHOSEN tenants (ali and demo1 only, leaving demo free)
  console.log('\n[Test 2] POST /api/occupy: Occupy chosen tenants ["ali", "demo1"] in stage_sekkat (NO per-tenant branch inputs)');
  const res2 = await request('POST', '/api/occupy', {
    spaceId: 'stage_sekkat',
    tenantIds: ['ali', 'demo1'],
    userName: 'Developer Alex',
    durationMinutes: 45
  });
  if (res2.status !== 200) throw new Error(`Test 2 failed: ${JSON.stringify(res2)}`);
  console.log('✓ Successfully occupied chosen tenants count:', res2.data.count);

  // Verify slots state
  const state1 = await request('GET', '/api/state');
  const ali = state1.data.slots['stage_sekkat:ali'];
  const demo = state1.data.slots['stage_sekkat:demo'];
  const demo1 = state1.data.slots['stage_sekkat:demo1'];

  console.log(`  - stage_sekkat:ali status: ${ali.status} (Occupant: ${ali.currentOccupant?.userName})`);
  console.log(`  - stage_sekkat:demo status: ${demo.status} (Expected: free)`);
  console.log(`  - stage_sekkat:demo1 status: ${demo1.status} (Occupant: ${demo1.currentOccupant?.userName})`);

  if (ali.status !== 'occupied' || demo.status !== 'free' || demo1.status !== 'occupied') {
    throw new Error('Tenant status mismatch! ali and demo1 should be occupied, demo should be free');
  }

  // Verify branches inherited from space
  console.log('✓ ali inherited branches:', ali.currentOccupant.branches);
  if (ali.currentOccupant.branches.frontend !== 'feat/space-fe-v1' ||
      ali.currentOccupant.branches.backend !== 'feat/space-be-v1') {
    throw new Error('Branches were not inherited from space!');
  }

  // Test 3: Edit whole space branches while tenants are occupied
  console.log('\n[Test 3] Update whole space branches for stage_sekkat while tenants are active');
  const res3 = await request('POST', '/api/space-branches', {
    spaceId: 'stage_sekkat',
    branches: {
      frontend: 'feat/space-fe-v2-UPDATED',
      backend: 'feat/space-be-v2-UPDATED',
      crm: 'feat/space-crm-v2-UPDATED'
    },
    userName: 'Admin'
  });
  if (res3.status !== 200) throw new Error(`Test 3 failed: ${JSON.stringify(res3)}`);

  const state2 = await request('GET', '/api/state');
  const aliUpdated = state2.data.slots['stage_sekkat:ali'];
  console.log('✓ ali automatically reflected updated space branch:', aliUpdated.currentOccupant.branches.frontend);
  if (aliUpdated.currentOccupant.branches.frontend !== 'feat/space-fe-v2-UPDATED') {
    throw new Error('Tenant did not reflect updated space branches!');
  }

  // Test 4: Release single tenant (demo1)
  console.log('\n[Test 4] Release single tenant stage_sekkat:demo1');
  const res4 = await request('POST', '/api/release', { slotId: 'stage_sekkat:demo1' });
  if (res4.status !== 200) throw new Error(`Test 4 failed: ${JSON.stringify(res4)}`);

  const state3 = await request('GET', '/api/state');
  if (state3.data.slots['stage_sekkat:demo1'].status !== 'free') {
    throw new Error('demo1 should be free');
  }
  if (state3.data.slots['stage_sekkat:ali'].status !== 'occupied') {
    throw new Error('ali should still be occupied');
  }
  console.log('✓ demo1 is free, ali is still occupied');

  // Test 5: Release all in stage_sekkat
  console.log('\n[Test 5] Release all in stage_sekkat');
  const res5 = await request('POST', '/api/release', { spaceId: 'stage_sekkat', releaseAll: true });
  if (res5.status !== 200) throw new Error(`Test 5 failed: ${JSON.stringify(res5)}`);

  const state4 = await request('GET', '/api/state');
  ['ali', 'demo', 'demo1'].forEach(tId => {
    if (state4.data.slots[`stage_sekkat:${tId}`].status !== 'free') {
      throw new Error(`stage_sekkat:${tId} should be free`);
    }
  });
  console.log('✓ All tenants in stage_sekkat are now free!');

  // Seed demo data
  console.log('\n[Test 6] Seed demo data');
  await request('POST', '/api/seed-demo');
  console.log('✓ Demo data seeded successfully.');

  console.log('\n===============================================');
  console.log('  ALL AUDIT TESTS PASSED WITH 100% SUCCESS!  ');
  console.log('===============================================');
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
