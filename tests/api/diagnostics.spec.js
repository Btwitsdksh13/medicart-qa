const { test, expect } = require('../helpers');
const addr = { pincode: '560001', line: 'MG Road' };
const book = (request, user, data) => request.post('/api/diagnostics/bookings', { headers: user, data: { testIds: ['T1'], slot: '2026-11-01T07:00', address: addr, patientAge: 30, ...data } });
test.describe('Diagnostics booking', () => {
  test('lists tests and only slots with capacity', async ({ request, user }) => {
    expect((await (await request.get('/api/diagnostics/tests')).json()).items.length).toBe(3);
    const s = await (await request.get('/api/diagnostics/slots?date=2026-11-01')).json();
    expect(s.items).toHaveLength(3);
    for (const x of s.items) expect(x.slot.startsWith('2026-11-01')).toBe(true);
  });
  test('books a test: amount, collection fee, no fasting note', async ({ request, user }) => {
    const b = await (await book(request, user, {})).json();
    expect(b.status).toBe('BOOKED'); expect(b.amount).toBe(350); expect(b.collectionFee).toBe(100); expect(b.fastingInstruction).toBeNull();
  });
  test('free collection at amount >= 500 and fasting note for lipid profile', async ({ request, user }) => {
    const b = await (await book(request, user, { testIds: ['T2', 'T1'] })).json();
    expect(b.amount).toBe(950); expect(b.collectionFee).toBe(0); expect(b.fastingInstruction).toContain('Fast');
  });
  test('booking reduces remaining slot capacity', async ({ request, user }) => {
    await book(request, user, {});
    const s = await (await request.get('/api/diagnostics/slots?date=2026-11-01')).json();
    expect(s.items.find(x => x.slot === '2026-11-01T07:00').remaining).toBe(2);
  });
  test('full slot cannot be booked again', async ({ request, user }) => {
    expect((await book(request, user, { slot: '2026-11-01T11:00' })).status()).toBe(201);
    const r = await book(request, { 'x-user-id': 'second' }, { slot: '2026-11-01T11:00' });
    expect(r.status()).toBe(409); expect((await r.json()).error).toBe('SLOT_FULL');
  });
  const bad = [['no tests', { testIds: [] }, 'NO_TESTS'], ['unknown test', { testIds: ['TX'] }, 'INVALID_TESTS'], ['duplicate test', { testIds: ['T1', 'T1'] }, 'INVALID_TESTS'],
    ['bad pincode', { address: { pincode: '0123' } }, 'INVALID_PINCODE'], ['negative age', { patientAge: -1 }, 'INVALID_AGE'], ['age too high', { patientAge: 121 }, 'INVALID_AGE'], ['unknown slot', { slot: 'x' }, 'SLOT_NOT_FOUND']];
  for (const [name, data, code] of bad) test(`validation: ${name}`, async ({ request, user }) => {
    const r = await book(request, user, data); expect((await r.json()).error).toBe(code); expect(r.status()).toBeGreaterThanOrEqual(400);
  });
  test('lifecycle BOOKED→SAMPLE_COLLECTED→REPORT_READY and no skipping', async ({ request, user }) => {
    const b = await (await book(request, user, {})).json();
    const st = (s) => request.post(`/api/diagnostics/bookings/${b.id}/status`, { headers: user, data: { status: s } });
    expect((await st('REPORT_READY')).status()).toBe(409);
    expect((await (await st('SAMPLE_COLLECTED')).json()).status).toBe('SAMPLE_COLLECTED');
    expect((await (await st('REPORT_READY')).json()).status).toBe('REPORT_READY');
    expect((await st('CANCELLED')).status()).toBe(409);
  });
  test('cancel frees the slot', async ({ request, user }) => {
    const b = await (await book(request, user, { slot: '2026-11-01T11:00' })).json();
    await request.post(`/api/diagnostics/bookings/${b.id}/status`, { headers: user, data: { status: 'CANCELLED' } });
    expect((await book(request, { 'x-user-id': 'next' }, { slot: '2026-11-01T11:00' })).status()).toBe(201);
  });
  test("another user cannot read or change someone's booking", async ({ request, user }) => {
    const b = await (await book(request, user, {})).json();
    const o = { 'x-user-id': 'intruder' };
    expect((await request.get(`/api/diagnostics/bookings/${b.id}`, { headers: o })).status()).toBe(403);
    expect((await request.post(`/api/diagnostics/bookings/${b.id}/status`, { headers: o, data: { status: 'CANCELLED' } })).status()).toBe(403);
  });
});
