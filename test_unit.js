import assert from 'assert';
import { hasIntervalOverlap, checkSlotConflict, normalizeBranches, DEFAULT_SPACES, TENANTS } from './server.js';

console.log('--- RUNNING TENANT RESERVER UNIT TESTS ---');

// 1. normalizeBranches tests
console.log('[1/4] Testing normalizeBranches...');
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
console.log('[2/4] Testing hasIntervalOverlap...');
assert.strictEqual(hasIntervalOverlap(10, 20, 15, 25), true, 'Overlapping intervals should be true');
assert.strictEqual(hasIntervalOverlap(10, 20, 20, 30), false, 'Adjacent intervals should not overlap');
assert.strictEqual(hasIntervalOverlap(10, 20, 5, 10), false, 'Adjacent intervals should not overlap');
assert.strictEqual(hasIntervalOverlap(10, 20, 0, 5), false, 'Non-overlapping intervals should be false');
assert.strictEqual(hasIntervalOverlap(10, 30, 12, 18), true, 'Sub-interval should overlap');
assert.strictEqual(hasIntervalOverlap(12, 18, 10, 30), true, 'Super-interval should overlap');
console.log('✓ hasIntervalOverlap passed');

// 3. checkSlotConflict tests
console.log('[3/4] Testing checkSlotConflict...');
const slotMock = {
  slotId: 'stage_sekkat:ali',
  tenantName: 'ali',
  status: 'occupied',
  currentOccupant: {
    userName: 'Alice',
    startedAt: 1000,
    endsAt: 5000
  },
  reservations: [
    {
      id: 'res-1',
      userName: 'Bob',
      startTime: 6000,
      endTime: 8000
    }
  ]
};

// Check conflict with occupant
const occConflict = checkSlotConflict(slotMock, 2000, 4000);
// Note: currentOccupant endsAt (5000) must be > now, but with arbitrary numbers Date.now() > 5000.
// Let's test with future timestamps:
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

const resNoConflict = checkSlotConflict(futureSlot, futureNow + 3700000, futureNow + 3900000);
assert.strictEqual(resNoConflict, null, 'Gap slot should have no conflict');
console.log('✓ checkSlotConflict passed');

// 4. Default configuration structure
console.log('[4/4] Verifying default configuration...');
assert.strictEqual(DEFAULT_SPACES.length, 3, 'Must have 3 default spaces');
assert.strictEqual(TENANTS.length, 3, 'Must have 3 default tenants');
console.log('✓ Default spaces and tenants verified');

console.log('\nAll unit tests passed successfully!');
