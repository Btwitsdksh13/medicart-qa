const { test, expect, addItem } = require('../helpers');
const book = (request, user, data) => request.post('/api/consultations', { headers: user, data: { doctorId: 'D1', time: '10:00', mode: 'VIDEO', symptoms: 'fever and cough', ...data } });
test.describe('Doctor consultation', () => {
  test('filters doctors by speciality', async ({ request, user }) => {
    const b = await (await request.get('/api/doctors?speciality=derma')).json();
    expect(b.items).toHaveLength(1); expect(b.items[0].id).toBe('D2');
  });
  test('booking removes slot from availability', async ({ request, user }) => {
    expect((await book(request, user, {})).status()).toBe(201);
    const d = (await (await request.get('/api/doctors?speciality=general')).json()).items[0];
    expect(d.availableSlots).not.toContain('10:00'); expect(d.availableSlots).toHaveLength(2);
  });
  test('double booking same slot is rejected', async ({ request, user }) => {
    await book(request, user, {});
    const r = await book(request, { 'x-user-id': 'other' }, {});
    expect(r.status()).toBe(409); expect((await r.json()).error).toBe('SLOT_TAKEN');
  });
  for (const [n, d, c] of [['bad mode', { mode: 'SMOKE' }, 'INVALID_MODE'], ['short symptoms', { symptoms: 'ab' }, 'SYMPTOMS_REQUIRED'], ['wrong slot', { time: '03:00' }, 'INVALID_SLOT'], ['unknown doctor', { doctorId: 'D9' }, 'DOCTOR_NOT_FOUND']])
    test(`validation: ${n}`, async ({ request, user }) => { expect((await (await book(request, user, d)).json()).error).toBe(c); });
  test('cancel refunds fee and frees slot; cannot cancel twice', async ({ request, user }) => {
    const c = await (await book(request, user, {})).json();
    const x = await (await request.post(`/api/consultations/${c.id}/cancel`, { headers: user })).json();
    expect(x.status).toBe('CANCELLED'); expect(x.refund).toBe(300);
    expect((await request.post(`/api/consultations/${c.id}/cancel`, { headers: user })).status()).toBe(409);
    expect((await book(request, { 'x-user-id': 'again' }, {})).status()).toBe(201);
  });
  test('cross-service: consult prescription unlocks Rx medicine order', async ({ request, user }) => {
    const c = await (await book(request, user, {})).json();
    const done = await (await request.post(`/api/consultations/${c.id}/complete`, { headers: user })).json();
    expect(done.status).toBe('COMPLETED'); expect(done.prescriptionId).toMatch(/^RX/);
    await addItem(request, user, 'M3');
    expect((await request.post('/api/orders', { headers: user, data: { paymentMethod: 'UPI' } })).status()).toBe(422);
    const o = await request.post('/api/orders', { headers: user, data: { paymentMethod: 'UPI', prescriptionId: done.prescriptionId } });
    expect(o.status()).toBe(201);
  });
});
