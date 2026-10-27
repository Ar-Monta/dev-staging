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
  console.log('=== TESTING NEW 3-BRANCH & WHOLE-SPACE FEATURES ===\n');

  // Reset first
  await request('POST', '/api/reset');

  // Test 1: Occupy single tenant with 3 optional branches (FE, BE, CRM)
  console.log('[Test 1] Occupy single tenant with all 3 branches');
  const res1 = await request('POST', '/api/occupy', {
    targetType: 'single',
    slotId: 'stage_sekkat:ali',
    userName: 'Alice',
    branches: {
      frontend: 'feat/checkout-ui-v2',
      backend: 'feat/orders-api-v2',
      crm: 'feat/crm-leads-sync'
    },
    durationMinutes: 30
  });
  if (res1.status !== 200) throw new Error(`Test 1 failed: ${JSON.stringify(res1)}`);
  const slot1 = res1.data.slot;
  console.log('✓ Status:', slot1.status);
  console.log('✓ Branches:', slot1.currentOccupant.branches);
  console.log('✓ Summary:', slot1.currentOccupant.branchName);
  if (slot1.currentOccupant.branches.frontend !== 'feat/checkout-ui-v2' ||
      slot1.currentOccupant.branches.backend !== 'feat/orders-api-v2' ||
      slot1.currentOccupant.branches.crm !== 'feat/crm-leads-sync') {
    throw new Error('Branches mismatch in slot1');
  }

  // Test 2: Occupy single tenant with only 1 branch (e.g. backend only, other 2 optional)
  console.log('\n[Test 2] Occupy single tenant with only backend branch (frontend & crm blank)');
  const res2 = await request('POST', '/api/occupy', {
    targetType: 'single',
    slotId: 'stage_sekkat:demo',
    userName: 'Bob',
    branches: {
      frontend: '',
      backend: 'fix/auth-leak',
      crm: ''
    },
    durationMinutes: 45
  });
  if (res2.status !== 200) throw new Error(`Test 2 failed: ${JSON.stringify(res2)}`);
  console.log('✓ Branches:', res2.data.slot.currentOccupant.branches);
  console.log('✓ Summary:', res2.data.slot.currentOccupant.branchName);

  // Test 3: Occupy WHOLE SPACE (preprod_talarey: all 3 tenants: ali, demo, demo1)
  console.log('\n[Test 3] Occupy WHOLE SPACE: preprod_talarey');
  const res3 = await request('POST', '/api/occupy', {
    targetType: 'space',
    spaceId: 'preprod_talarey',
    userName: 'Charlie Release Manager',
    branches: {
      frontend: 'release/v4.0.0',
      backend: 'release/v4.0.0-core',
      crm: 'release/v4.0.0-crm'
    },
    durationMinutes: 60
  });
  if (res3.status !== 200) throw new Error(`Test 3 failed: ${JSON.stringify(res3)}`);
  console.log(`✓ Whole space claimed: ${res3.data.claimedCount} slots occupied with spaceGroupId: ${res3.data.spaceGroupId}`);

  // Verify all 3 slots of preprod_talarey are occupied
  const stateCheck = await request('GET', '/api/state');
  const talareySlots = ['preprod_talarey:ali', 'preprod_talarey:demo', 'preprod_talarey:demo1'];
  for (const tid of talareySlots) {
    const s = stateCheck.data.slots[tid];
    if (s.status !== 'occupied') throw new Error(`Expected ${tid} to be occupied`);
    console.log(`  - ${tid} is occupied by ${s.currentOccupant.userName} with FE: ${s.currentOccupant.branches.frontend}`);
  }

  // Test 4: EDIT BRANCHES on the fly for stage_sekkat:ali
  console.log('\n[Test 4] Edit branches on the fly for stage_sekkat:ali');
  const res4 = await request('POST', '/api/update-branches', {
    slotId: 'stage_sekkat:ali',
    branches: {
      frontend: 'feat/checkout-ui-v2-UPDATED',
      backend: 'feat/orders-api-v2',
      crm: 'feat/crm-leads-sync-HOTFIX'
    },
    userName: 'Alice'
  });
  if (res4.status !== 200) throw new Error(`Test 4 failed: ${JSON.stringify(res4)}`);
  console.log('✓ Updated branches for slot:', res4.data.slot.currentOccupant.branches);
  if (res4.data.slot.currentOccupant.branches.frontend !== 'feat/checkout-ui-v2-UPDATED') {
    throw new Error('Branch frontend update failed');
  }

  // Test 5: EDIT BRANCHES across WHOLE SPACE (preprod_talarey)
  console.log('\n[Test 5] Edit branches across WHOLE SPACE: preprod_talarey');
  const res5 = await request('POST', '/api/update-branches', {
    spaceId: 'preprod_talarey',
    updateWholeSpace: true,
    branches: {
      frontend: 'release/v4.0.1-patch',
      backend: 'release/v4.0.1-patch-core',
      crm: 'release/v4.0.1-patch-crm'
    },
    userName: 'Charlie Release Manager'
  });
  if (res5.status !== 200) throw new Error(`Test 5 failed: ${JSON.stringify(res5)}`);
  console.log(`✓ Updated branches across ${res5.data.updatedCount} slots in preprod_talarey`);

  // Verify that all slots in preprod_talarey have the updated branch
  const stateCheck2 = await request('GET', '/api/state');
  for (const tid of talareySlots) {
    const s = stateCheck2.data.slots[tid];
    if (s.currentOccupant.branches.frontend !== 'release/v4.0.1-patch') {
      throw new Error(`Branch not updated in ${tid}`);
    }
  }
  console.log('✓ All 3 slots verified to have updated branches: release/v4.0.1-patch');

  // Test 6: RELEASE WHOLE SPACE
  console.log('\n[Test 6] Release WHOLE SPACE: preprod_talarey');
  const res6 = await request('POST', '/api/release', {
    spaceId: 'preprod_talarey',
    releaseWholeSpace: true,
    userName: 'Charlie Release Manager'
  });
  if (res6.status !== 200) throw new Error(`Test 6 failed: ${JSON.stringify(res6)}`);
  console.log(`✓ Released ${res6.data.releasedCount} slots from preprod_talarey`);

  const stateCheck3 = await request('GET', '/api/state');
  for (const tid of talareySlots) {
    if (stateCheck3.data.slots[tid].status !== 'free') {
      throw new Error(`Expected ${tid} to be freed`);
    }
  }
  console.log('✓ All 3 slots in preprod_talarey are now POPPED OUT and FREE!');

  // Seed rich demo data
  console.log('\n[Test 7] Seeding realistic demo data with 3 branches & whole space...');
  await request('POST', '/api/seed-demo');
  console.log('✓ Demo data seeded.');

  console.log('\n===============================================');
  console.log('  ALL NEW FEATURES VERIFIED SUCCESSFULLY!  ');
  console.log('===============================================');
}

runAudit().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
