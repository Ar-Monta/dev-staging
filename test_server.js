import http from 'http';
import { WebSocket } from 'ws';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
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
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING TENANT RESERVER AUTOMATED AUDIT & TESTS ---');

  // Test 1: GET /api/state
  console.log('\n[Test 1] GET /api/state: checking initial state');
  const res1 = await request('GET', '/api/state');
  if (res1.status !== 200) throw new Error(`Expected 200, got ${res1.status}`);
  console.log('✓ Spaces returned:', res1.data.spaces.map(s => s.displayName).join(', '));
  console.log('✓ Tenants returned:', res1.data.tenants.map(t => t.displayName).join(', '));
  const slotKeys = Object.keys(res1.data.slots);
  console.log(`✓ Total slots: ${slotKeys.length} (Expected 9)`);
  if (slotKeys.length !== 9) throw new Error('Expected 9 slots');

  // Test 2: POST /api/occupy
  console.log('\n[Test 2] POST /api/occupy: push in ali on stage sekkat');
  const occupyPayload = {
    slotId: 'stage_sekkat:ali',
    userName: 'Sarah Connor',
    branchName: 'feature/terminator-defense',
    durationMinutes: 30,
    notes: 'Urgent security tests'
  };
  const res2 = await request('POST', '/api/occupy', occupyPayload);
  if (res2.status !== 200) throw new Error(`Occupy failed: ${JSON.stringify(res2)}`);
  console.log('✓ Slot occupied successfully. Status:', res2.data.slot.status);
  console.log('✓ Occupant:', res2.data.slot.currentOccupant.userName, '| Branch:', res2.data.slot.currentOccupant.branchName);
  console.log('✓ Ends at:', new Date(res2.data.slot.currentOccupant.endsAt).toISOString());

  // Test 3: Conflict check (trying to occupy the same slot again)
  console.log('\n[Test 3] Attempt double-occupy on already busy slot');
  const res3 = await request('POST', '/api/occupy', {
    slotId: 'stage_sekkat:ali',
    userName: 'John Doe',
    branchName: 'bugfix/something',
    durationMinutes: 15
  });
  if (res3.status === 400 && res3.data.error.includes('currently in use')) {
    console.log('✓ Double occupy correctly rejected with error:', res3.data.error);
  } else {
    throw new Error(`Expected conflict error, got: ${JSON.stringify(res3)}`);
  }

  // Test 4: POST /api/extend
  console.log('\n[Test 4] POST /api/extend: extend time by +15m');
  const endsAtBefore = res2.data.slot.currentOccupant.endsAt;
  const res4 = await request('POST', '/api/extend', {
    slotId: 'stage_sekkat:ali',
    additionalMinutes: 15
  });
  if (res4.status !== 200) throw new Error(`Extend failed: ${JSON.stringify(res4)}`);
  const endsAtAfter = res4.data.slot.currentOccupant.endsAt;
  const extendedDiffMins = (endsAtAfter - endsAtBefore) / (60 * 1000);
  console.log(`✓ Slot extended by ${extendedDiffMins} minutes. New endsAt: ${new Date(endsAtAfter).toISOString()}`);

  // Test 5: POST /api/reserve (Schedule a future slot)
  console.log('\n[Test 5] POST /api/reserve: schedule a future reservation');
  const futureStart = Date.now() + (60 * 60 * 1000); // 1 hour in the future
  const reservePayload = {
    slotId: 'stage_sekkat:ali',
    userName: 'Kyle Reese',
    branchName: 'release/v2.0.0',
    startTime: new Date(futureStart).toISOString(),
    durationMinutes: 45,
    notes: 'Scheduled regression run'
  };
  const res5 = await request('POST', '/api/reserve', reservePayload);
  if (res5.status !== 200) throw new Error(`Reserve failed: ${JSON.stringify(res5)}`);
  console.log('✓ Reservation created with ID:', res5.data.reservation.id);
  console.log('✓ Scheduled for:', new Date(res5.data.reservation.startTime).toISOString(), 'Duration:', res5.data.reservation.durationMinutes, 'mins');

  // Test 6: Verify WebSocket real-time updates
  console.log('\n[Test 6] WebSocket connection and broadcast check');
  await new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:3000');
    let receivedInit = false;

    ws.on('open', () => {
      console.log('✓ WebSocket connected to ws://localhost:3000');
    });

    ws.on('message', (msgText) => {
      const msg = JSON.parse(msgText);
      if (msg.type === 'INIT') {
        receivedInit = true;
        console.log('✓ Received INIT state with', Object.keys(msg.payload.slots).length, 'slots and', msg.payload.history.length, 'history items');
        ws.close();
        resolve();
      }
    });

    ws.on('error', reject);
    setTimeout(() => {
      if (!receivedInit) reject(new Error('WebSocket timed out waiting for INIT'));
    }, 3000);
  });

  // Test 7: Release slot (push out)
  console.log('\n[Test 7] POST /api/release: push out / free tenant');
  const res7 = await request('POST', '/api/release', {
    slotId: 'stage_sekkat:ali',
    userName: 'Sarah Connor'
  });
  if (res7.status !== 200) throw new Error(`Release failed: ${JSON.stringify(res7)}`);
  console.log('✓ Slot released. New status:', res7.data.slot.status, '(Occupant:', res7.data.slot.currentOccupant, ')');

  // Test 8: Check History audit log
  console.log('\n[Test 8] GET /api/history: check audit trail');
  const res8 = await request('GET', '/api/history');
  console.log(`✓ History entries recorded: ${res8.data.length}`);
  console.log('✓ Latest actions:', res8.data.slice(0, 3).map(h => `${h.action}: ${h.message}`).join(' | '));

  console.log('\n===============================================');
  console.log('  ALL AUDIT TESTS PASSED SUCCESSFULLY!  ');
  console.log('===============================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
