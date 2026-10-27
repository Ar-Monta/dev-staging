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

async function runConflictAudit() {
  console.log('=== RIGOROUS CONFLICT PREVENTION TEST SUITE ===\n');

  // Reset all state first
  await request('POST', '/api/reset');

  const now = Date.now();
  const tomorrow2PM = new Date(now + 24 * 60 * 60 * 1000);
  tomorrow2PM.setHours(14, 0, 0, 0);
  const timeA = tomorrow2PM.getTime();

  // Test 1: User A books 2:00 PM - 3:00 PM (60m)
  console.log('[Test 1] User A reserves stage_sekkat:ali from 2:00 PM to 3:00 PM (60m)');
  const res1 = await request('POST', '/api/reserve', {
    spaceId: 'stage_sekkat',
    tenantIds: ['ali'],
    userName: 'User A',
    startTime: new Date(timeA).toISOString(),
    durationMinutes: 60
  });
  if (res1.status !== 200) throw new Error(`Booking User A failed: ${JSON.stringify(res1)}`);
  console.log('✓ User A booked successfully');

  // Test 2: User B tries 2:30 PM - 3:30 PM (Partial overlap)
  console.log('\n[Test 2] User B attempts 2:30 PM - 3:30 PM (Partial overlap: conflicts)');
  const timeB = timeA + (30 * 60 * 1000); // 2:30 PM
  const res2 = await request('POST', '/api/reserve', {
    spaceId: 'stage_sekkat',
    tenantIds: ['ali'],
    userName: 'User B',
    startTime: new Date(timeB).toISOString(),
    durationMinutes: 60
  });
  if (res2.status === 400 && res2.data.error.includes('conflicts with existing reservation')) {
    console.log('✓ User B correctly REJECTED with conflict message:', res2.data.error);
  } else {
    throw new Error(`Expected conflict rejection, got: ${JSON.stringify(res2)}`);
  }

  // Test 3: User C tries 2:15 PM - 2:45 PM (Completely enclosed inside User A's window)
  console.log('\n[Test 3] User C attempts 2:15 PM - 2:45 PM (Completely enclosed inside User A)');
  const timeC = timeA + (15 * 60 * 1000);
  const res3 = await request('POST', '/api/reserve', {
    spaceId: 'stage_sekkat',
    tenantIds: ['ali'],
    userName: 'User C',
    startTime: new Date(timeC).toISOString(),
    durationMinutes: 30
  });
  if (res3.status === 400 && res3.data.error.includes('conflicts with existing reservation')) {
    console.log('✓ User C correctly REJECTED with conflict message:', res3.data.error);
  } else {
    throw new Error(`Expected conflict rejection, got: ${JSON.stringify(res3)}`);
  }

  // Test 4: Multi-Tenant Atomic Check
  // User D attempts to reserve ['ali', 'demo'] from 2:00 PM to 3:00 PM.
  // demo is free, but ali conflicts! The whole request must fail and demo must NOT be reserved!
  console.log('\n[Test 4] Multi-tenant atomic check: User D requests ["ali", "demo"] where ali conflicts');
  const res4 = await request('POST', '/api/reserve', {
    spaceId: 'stage_sekkat',
    tenantIds: ['ali', 'demo'],
    userName: 'User D',
    startTime: new Date(timeA).toISOString(),
    durationMinutes: 60
  });
  if (res4.status === 400 && res4.data.error.includes('conflicts with existing reservation')) {
    console.log('✓ User D correctly REJECTED with conflict message:', res4.data.error);
  } else {
    throw new Error(`Expected conflict rejection, got: ${JSON.stringify(res4)}`);
  }

  // Verify demo has NO reservations (atomic integrity check)
  const stateCheck = await request('GET', '/api/state');
  const demoSlot = stateCheck.data.slots['stage_sekkat:demo'];
  if (demoSlot.reservations.length !== 0) {
    throw new Error('Atomic check failed! demo was partially mutated despite conflict on ali');
  }
  console.log('✓ Atomic integrity verified: demo has 0 reservations');

  // Test 5: Consecutive Non-Conflicting Reservation
  // User E books 3:00 PM - 4:00 PM (starts right when User A ends)
  console.log('\n[Test 5] Consecutive Non-Conflicting booking: User E requests 3:00 PM - 4:00 PM');
  const timeE = timeA + (60 * 60 * 1000); // exactly 3:00 PM
  const res5 = await request('POST', '/api/reserve', {
    spaceId: 'stage_sekkat',
    tenantIds: ['ali'],
    userName: 'User E',
    startTime: new Date(timeE).toISOString(),
    durationMinutes: 60
  });
  if (res5.status === 200) {
    console.log('✓ Consecutive booking User E accepted with 200 OK');
  } else {
    throw new Error(`Consecutive booking failed: ${JSON.stringify(res5)}`);
  }

  // Test 6: Conflict with Active Occupant
  console.log('\n[Test 6] Conflict with Active Occupant: occupy beta:demo now for 60m, then try to reserve in 20m');
  await request('POST', '/api/occupy', {
    spaceId: 'beta',
    tenantIds: ['demo'],
    userName: 'Live User',
    durationMinutes: 60
  });

  const res6 = await request('POST', '/api/reserve', {
    spaceId: 'beta',
    tenantIds: ['demo'],
    userName: 'Late Reserver',
    startTime: new Date(now + 20 * 60 * 1000).toISOString(),
    durationMinutes: 30
  });
  if (res6.status === 400 && res6.data.error.includes('currently occupied')) {
    console.log('✓ Overlap with active occupant correctly REJECTED:', res6.data.error);
  } else {
    throw new Error(`Expected active occupant conflict, got: ${JSON.stringify(res6)}`);
  }

  // Test 7: Pre-flight check endpoint POST /api/check-conflicts
  console.log('\n[Test 7] Pre-flight conflict check API /api/check-conflicts');
  const res7 = await request('POST', '/api/check-conflicts', {
    spaceId: 'stage_sekkat',
    tenantIds: ['ali'],
    startTime: new Date(timeA + 10 * 60 * 1000).toISOString(),
    durationMinutes: 30
  });
  if (res7.status === 200 && res7.data.hasConflict === true && res7.data.conflicts.length > 0) {
    console.log('✓ Pre-flight check correctly detected conflict:', res7.data.conflicts[0].message);
  } else {
    throw new Error(`Pre-flight check failed: ${JSON.stringify(res7)}`);
  }

  // Clean demo seed
  console.log('\n[Test 8] Seeding demo state');
  await request('POST', '/api/seed-demo');
  console.log('✓ Seeded cleanly');

  console.log('\n===============================================');
  console.log('  ALL CONFLICT PREVENTION TESTS PASSED 100%!   ');
  console.log('===============================================');
}

runConflictAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
