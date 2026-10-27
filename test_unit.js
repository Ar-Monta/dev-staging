import assert from 'assert';
import { hasIntervalOverlap, checkSlotConflict, normalizeBranches, normalizeIp, canModifyItem, DEFAULT_SPACES, TENANTS } from './server.js';

console.log('--- RUNNING TENANT RESERVER UNIT TESTS ---');

// 1. normalizeBranches tests
console.log('[1/5] Testing normalizeBranches...');
assert.deepStrictEqual(
  normalizeBranches({ frontend: 'feat/ui', backend: 'feat/api', crm: 'feat/crm' }),
  {
    branches: { frontend: 'feat/ui', backend: 'feat/api', crm: 'feat/crm' },
    branchName: 'FE: feat/ui • BE: feat/api • CRM: feat/crm'
  }
);
assert.deepStrictEqual(
  normalizeBranches({ frontend: 'main', backend: '', crm: '' }),
  {
    branches: { frontend: 'main', backend: '', crm: '' },
    branchName: 'FE: main'
  }
);
assert.deepStrictEqual(
  normalizeBranches(null),
  {
    branches: { frontend: '', backend: '', crm: '' },
    branchName: 'main'
  }
);
console.log('✓ normalizeBranches passed');

// 2. hasIntervalOverlap tests
console.log('[2/5] Testing hasIntervalOverlap...');
assert.strictEqual(hasIntervalOverlap(10, 20, 15, 25), true, 'Overlapping intervals should be true');
assert.strictEqual(hasIntervalOverlap(10, 20, 20, 30), false, 'Adjacent intervals should not overlap');
assert.strictEqual(hasIntervalOverlap(10, 20, 5, 10), false, 'Adjacent intervals should not overlap');
assert.strictEqual(hasIntervalOverlap(10, 20, 0, 5), false, 'Non-overlapping intervals should be false');
assert.strictEqual(hasIntervalOverlap(10, 30, 12, 18), true, 'Sub-interval should overlap');
assert.strictEqual(hasIntervalOverlap(12, 18, 10, 30), true, 'Super-interval should overlap');
console.log('✓ hasIntervalOverlap passed');

// 3. checkSlotConflict tests (including ignoreReservationId for edits)
console.log('[3/5] Testing checkSlotConflict & ignoreReservationId...');
const futureNow = Date.now() + 100000;
const futureSlot = {
  slotId: 'stage_sekkat:ali',
  tenantName: 'ali',
  status: 'occupied',
  currentOccupant: {
    userName: 'Alice',
    startedAt: futureNow,
    endsAt: futureNow + 3600000
  },
  reservations: [
    {
      id: 'res-1',
      userName: 'Bob',
      startTime: futureNow + 4000000,
      endTime: futureNow + 7200000
    }
  ]
};

const resOverlapOccupant = checkSlotConflict(futureSlot, futureNow + 1000, futureNow + 2000);
assert(resOverlapOccupant !== null, 'Should detect conflict with current occupant');
assert.strictEqual(resOverlapOccupant.type, 'CURRENT_OCCUPANT');

const resOverlapReservation = checkSlotConflict(futureSlot, futureNow + 5000000, futureNow + 6000000);
assert(resOverlapReservation !== null, 'Should detect conflict with future reservation');
assert.strictEqual(resOverlapReservation.type, 'RESERVATION');

// Editing res-1 itself should NOT conflict when ignoreReservationId is passed
const resSelfEdit = checkSlotConflict(futureSlot, futureNow + 5000000, futureNow + 6000000, 'res-1');
assert.strictEqual(resSelfEdit, null, 'Self-edit should be ignored when checking conflicts');

const resNoConflict = checkSlotConflict(futureSlot, futureNow + 3700000, futureNow + 3900000);
assert.strictEqual(resNoConflict, null, 'Gap slot should have no conflict');
console.log('✓ checkSlotConflict passed');

// 4. IP Normalization & Authorization check
console.log('[4/5] Testing normalizeIp & canModifyItem...');
assert.strictEqual(normalizeIp('127.0.0.1'), '127.0.0.1');
assert.strictEqual(normalizeIp('::1'), '127.0.0.1');
assert.strictEqual(normalizeIp('localhost'), '127.0.0.1');
assert.strictEqual(normalizeIp('::ffff:192.168.1.50'), '192.168.1.50');
assert.strictEqual(normalizeIp('192.168.1.50'), '192.168.1.50');

assert.strictEqual(canModifyItem('192.168.1.50', '192.168.1.50'), true, 'Same IP should be allowed');
assert.strictEqual(canModifyItem('::ffff:192.168.1.50', '192.168.1.50'), true, 'IPv6-mapped should match');
assert.strictEqual(canModifyItem('127.0.0.1', '::1'), true, 'Localhost variants should match');
assert.strictEqual(canModifyItem('192.168.1.50', '192.168.1.99'), false, 'Different IP should be forbidden');
assert.strictEqual(canModifyItem(null, '192.168.1.99'), true, 'Legacy items without IP should be allowed');
console.log('✓ normalizeIp & canModifyItem passed');

// 5. Default configuration structure
console.log('[5/5] Verifying default configuration...');
assert.strictEqual(DEFAULT_SPACES.length, 3, 'Must have 3 default spaces');
assert.strictEqual(TENANTS.length, 3, 'Must have 3 default tenants');
console.log('✓ Default spaces and tenants verified');

console.log('\nAll unit tests passed successfully!');
