import http from 'http';
import assert from 'assert';
import app from './server.js';

console.log('--- RUNNING IP AUTHORIZATION INTEGRATION TESTS ---');

const PORT = 3999;
const server = http.createServer(app);

function request(method, path, body = null, ip = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
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
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  await new Promise(r => server.listen(PORT, r));

  try {
    // 0. Reset state
    await request('POST', '/api/reset');

    const IP_ALICE = '192.168.1.100';
    const IP_BOB = '192.168.1.200';

    // 1. Check /api/me returns correct IP
    console.log('[Test 1] Verify IP detection via x-forwarded-for...');
    const meAlice = await request('GET', '/api/me', null, IP_ALICE);
    assert.strictEqual(meAlice.data.ip, IP_ALICE, 'Should detect Alice IP');

    const meBob = await request('GET', '/api/me', null, IP_BOB);
    assert.strictEqual(meBob.data.ip, IP_BOB, 'Should detect Bob IP');
    console.log('✓ IP detection verified');

    // 2. Alice reserves tenant ali in stage_sekkat
    console.log('[Test 2] Alice (192.168.1.100) reserves stage_sekkat:ali for tomorrow...');
    const futureTime = new Date(Date.now() + 86400000).toISOString();
    const resReserve = await request('POST', '/api/reserve', {
      spaceId: 'stage_sekkat',
      tenantIds: ['ali'],
      userName: 'Alice',
      startTime: futureTime,
      durationMinutes: 60,
      notes: 'Alice QA Run'
    }, IP_ALICE);
    assert.strictEqual(resReserve.status, 200);

    const stateRes = await request('GET', '/api/state', null, IP_ALICE);
    const slot = stateRes.data.slots['stage_sekkat:ali'];
    assert.strictEqual(slot.reservations.length, 1);
    const reservation = slot.reservations[0];
    assert.strictEqual(reservation.creatorIp, IP_ALICE);
    console.log('✓ Alice reservation created with creatorIp =', reservation.creatorIp);

    // 3. Bob (192.168.1.200) tries to edit Alice's reservation -> MUST BE REJECTED 403
    console.log('[Test 3] Bob (192.168.1.200) attempts to modify Alice reservation -> Expect 403 Forbidden...');
    const bobEdit = await request('POST', '/api/reserve/update', {
      slotId: 'stage_sekkat:ali',
      reservationId: reservation.id,
      userName: 'Hacked by Bob',
      startTime: futureTime,
      durationMinutes: 90
    }, IP_BOB);
    assert.strictEqual(bobEdit.status, 403, `Expected 403 Forbidden, got ${bobEdit.status}: ${JSON.stringify(bobEdit.data)}`);
    assert(bobEdit.data.error.includes('Permission denied'), 'Error should state permission denied');
    console.log('✓ Bob modification blocked with 403:', bobEdit.data.error);

    // 4. Bob tries to cancel Alice's reservation -> MUST BE REJECTED 403
    console.log('[Test 4] Bob attempts to cancel Alice reservation -> Expect 403 Forbidden...');
    const bobCancel = await request('DELETE', `/api/reserve/stage_sekkat:ali/${reservation.id}`, null, IP_BOB);
    assert.strictEqual(bobCancel.status, 403, `Expected 403 Forbidden, got ${bobCancel.status}`);
    assert(bobCancel.data.error.includes('Permission denied'), 'Error should state permission denied');
    console.log('✓ Bob cancellation blocked with 403:', bobCancel.data.error);

    // 5. Alice modifies her own reservation -> MUST SUCCEED 200
    console.log('[Test 5] Alice modifies her own reservation -> Expect 200 OK...');
    const aliceEdit = await request('POST', '/api/reserve/update', {
      slotId: 'stage_sekkat:ali',
      reservationId: reservation.id,
      userName: 'Alice Updated',
      startTime: futureTime,
      durationMinutes: 90,
      branches: { frontend: 'feat/checkout', backend: 'feat/cart', crm: '' }
    }, IP_ALICE);
    assert.strictEqual(aliceEdit.status, 200, `Expected 200, got ${aliceEdit.status}: ${JSON.stringify(aliceEdit.data)}`);
    assert.strictEqual(aliceEdit.data.reservation.durationMinutes, 90);
    assert.strictEqual(aliceEdit.data.reservation.userName, 'Alice Updated');
    console.log('✓ Alice successfully updated her reservation to 90m');

    // 6. Alice occupies demo in stage_sekkat
    console.log('[Test 6] Alice occupies stage_sekkat:demo (Active In-Use)...');
    const aliceOccupy = await request('POST', '/api/occupy', {
      spaceId: 'stage_sekkat',
      tenantIds: ['demo'],
      userName: 'Alice In Person',
      durationMinutes: 30
    }, IP_ALICE);
    assert.strictEqual(aliceOccupy.status, 200);

    // 7. Bob attempts to release or extend Alice's active occupant -> MUST BE REJECTED 403
    console.log('[Test 7] Bob tries to release Alice active occupant -> Expect 403 Forbidden...');
    const bobRelease = await request('POST', '/api/release', { slotId: 'stage_sekkat:demo' }, IP_BOB);
    assert.strictEqual(bobRelease.status, 403);
    console.log('✓ Bob release blocked with 403:', bobRelease.data.error);

    console.log('[Test 8] Bob tries to extend Alice active occupant -> Expect 403 Forbidden...');
    const bobExtend = await request('POST', '/api/extend', { slotId: 'stage_sekkat:demo', additionalMinutes: 15 }, IP_BOB);
    assert.strictEqual(bobExtend.status, 403);
    console.log('✓ Bob extend blocked with 403:', bobExtend.data.error);

    // 8. Alice releases her occupant -> MUST SUCCEED 200
    console.log('[Test 9] Alice releases her own active occupant -> Expect 200 OK...');
    const aliceRelease = await request('POST', '/api/release', { slotId: 'stage_sekkat:demo' }, IP_ALICE);
    assert.strictEqual(aliceRelease.status, 200);
    console.log('✓ Alice successfully released her occupant');

    // 9. Alice cancels her reservation -> MUST SUCCEED 200
    console.log('[Test 10] Alice cancels her own reservation -> Expect 200 OK...');
    const aliceCancel = await request('DELETE', `/api/reserve/stage_sekkat:ali/${reservation.id}`, null, IP_ALICE);
    assert.strictEqual(aliceCancel.status, 200);
    console.log('✓ Alice successfully cancelled her reservation');

    console.log('\nALL IP AUTHORIZATION TESTS PASSED PERFECTLY! 🚀');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
