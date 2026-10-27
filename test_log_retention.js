import http from 'http';
import fs from 'fs';

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

async function testRetention() {
  console.log('=== TESTING 24-HOUR (1 DAY) LOG RETENTION ===\n');

  // Trigger an action to create a fresh log
  await request('POST', '/api/space-branches', {
    spaceId: 'stage_sekkat',
    branches: { frontend: 'feat/today-branch' },
    userName: 'Tester Today'
  });

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Read current history from API
  const res1 = await request('GET', '/api/history');
  console.log(`✓ Current active history entries: ${res1.data.length}`);

  // Verify that all returned entries are within the last 24 hours
  const olderThanOneDay = res1.data.filter(item => (now - item.timestamp) > ONE_DAY_MS);
  console.log(`✓ Entries older than 1 day found: ${olderThanOneDay.length} (Expected: 0)`);
  if (olderThanOneDay.length > 0) {
    throw new Error('Found entries older than 24 hours!');
  }

  // Verify timestamps
  res1.data.forEach(item => {
    const ageHours = (now - item.timestamp) / (1000 * 60 * 60);
    console.log(`  - Log [${item.action}]: "${item.message}" (Age: ${ageHours.toFixed(2)} hours ago)`);
  });

  console.log('\n===============================================');
  console.log('  24-HOUR LOG RETENTION VERIFIED SUCCESSFULLY! ');
  console.log('===============================================');
}

testRetention().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
