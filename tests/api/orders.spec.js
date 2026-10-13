const { test, expect, addItem } = require('../helpers');
const place = (request, user, data) => request.post('/api/orders', { headers: user, data });
test.describe('Checkout & order lifecycle', () => {
  test('empty cart cannot be checked out', async ({ request, user }) => {
    const r = await place(request, user, { paymentMethod: 'UPI' });
    expect(r.status()).toBe(400); expect((await r.json()).error).toBe('EMPTY_CART');
  });
  test('OTC order succeeds, decrements stock, clears cart', async ({ request, user }) => {
    await addItem(request, user, 'M1', 3);
    const r = await place(request, user, { paymentMethod: 'UPI' });
    expect(r.status()).toBe(201);
    const o = await r.json();
    expect(o.status).toBe('PLACED'); expect(o.paymentStatus).toBe('PAID');
    expect((await (await request.get('/api/medicines/M1')).json()).stock).toBe(97);
    expect((await (await request.get('/api/cart', { headers: user })).json()).items).toHaveLength(0);
  });
  test('COD order has payment PENDING', async ({ request, user }) => {
    await addItem(request, user, 'M1');
    expect((await (await place(request, user, { paymentMethod: 'COD' })).json()).paymentStatus).toBe('PENDING');
  });
  test('Rx medicine blocked without prescription', async ({ request, user }) => {
    await addItem(request, user, 'M3');
    const r = await place(request, user, { paymentMethod: 'UPI' });
    expect(r.status()).toBe(422); expect((await r.json()).error).toBe('PRESCRIPTION_REQUIRED');
  });
  test('Rx medicine allowed with valid prescription upload', async ({ request, user }) => {
    const rx = await (await request.post('/api/prescriptions', { headers: user, data: { fileName: 'rx.pdf' } })).json();
    await addItem(request, user, 'M3');
    expect((await place(request, user, { paymentMethod: 'CARD', prescriptionId: rx.id })).status()).toBe(201);
  });
  test('prescription of another user is not accepted', async ({ request, user }) => {
    const rx = await (await request.post('/api/prescriptions', { headers: { 'x-user-id': 'other' }, data: { fileName: 'rx.png' } })).json();
    await addItem(request, user, 'M3');
    expect((await place(request, user, { paymentMethod: 'UPI', prescriptionId: rx.id })).status()).toBe(422);
  });
  test('invalid prescription file type rejected', async ({ request, user }) => {
    const r = await request.post('/api/prescriptions', { headers: user, data: { fileName: 'rx.exe' } });
    expect(r.status()).toBe(400);
  });
  test('payment failure leaves stock and cart untouched', async ({ request, user }) => {
    await addItem(request, user, 'M1', 2);
    const r = await place(request, user, { paymentMethod: 'UPI', simulatePaymentFailure: true });
    expect(r.status()).toBe(402);
    expect((await (await request.get('/api/medicines/M1')).json()).stock).toBe(100);
    expect((await (await request.get('/api/cart', { headers: user })).json()).items).toHaveLength(1);
  });
  test('idempotency key prevents duplicate orders', async ({ request, user }) => {
    await addItem(request, user, 'M1', 2);
    const h = { ...user, 'idempotency-key': 'k1' };
    const a = await (await request.post('/api/orders', { headers: h, data: { paymentMethod: 'UPI' } })).json();
    const b = await (await request.post('/api/orders', { headers: h, data: { paymentMethod: 'UPI' } })).json();
    expect(b.id).toBe(a.id);
    expect((await (await request.get('/api/medicines/M1')).json()).stock).toBe(98);
  });
  test('order visible only to its owner', async ({ request, user }) => {
    await addItem(request, user, 'M1');
    const o = await (await place(request, user, { paymentMethod: 'UPI' })).json();
    expect((await request.get(`/api/orders/${o.id}`, { headers: { 'x-user-id': 'intruder' } })).status()).toBe(403);
  });
  test('happy-path lifecycle PLACED→DELIVERED with history', async ({ request, user }) => {
    await addItem(request, user, 'M1');
    const o = await (await place(request, user, { paymentMethod: 'UPI' })).json();
    let last;
    for (const s of ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED']) {
      last = await (await request.post(`/api/orders/${o.id}/status`, { headers: user, data: { status: s } })).json();
      expect(last.status).toBe(s);
    }
    expect(last.history.map(h => h.status)).toEqual(['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED']);
  });
  for (const [from, bad] of [['PLACED', 'SHIPPED'], ['PLACED', 'DELIVERED']]) {
    test(`illegal transition ${from}→${bad} blocked`, async ({ request, user }) => {
      await addItem(request, user, 'M1');
      const o = await (await place(request, user, { paymentMethod: 'UPI' })).json();
      const r = await request.post(`/api/orders/${o.id}/status`, { headers: user, data: { status: bad } });
      expect(r.status()).toBe(409); expect((await r.json()).error).toBe('INVALID_TRANSITION');
    });
  }
  test('cancel restores stock and initiates refund; no cancel after shipping', async ({ request, user }) => {
    await addItem(request, user, 'M1', 4);
    const o = await (await place(request, user, { paymentMethod: 'UPI' })).json();
    const c = await (await request.post(`/api/orders/${o.id}/status`, { headers: user, data: { status: 'CANCELLED' } })).json();
    expect(c.paymentStatus).toBe('REFUND_INITIATED');
    expect((await (await request.get('/api/medicines/M1')).json()).stock).toBe(100);
    await addItem(request, user, 'M1');
    const o2 = await (await place(request, user, { paymentMethod: 'UPI' })).json();
    for (const s of ['CONFIRMED', 'PACKED', 'SHIPPED']) await request.post(`/api/orders/${o2.id}/status`, { headers: user, data: { status: s } });
    expect((await request.post(`/api/orders/${o2.id}/status`, { headers: user, data: { status: 'CANCELLED' } })).status()).toBe(409);
  });
  test('concurrent checkouts never oversell last units', async ({ request }) => {
    // M4 has stock 5; 4 users each want 2 -> at most 2 can succeed
    const users = ['c1', 'c2', 'c3', 'c4'].map(u => ({ 'x-user-id': u }));
    await request.post('/api/test/reset');
    for (const u of users) {
      const rx = await (await request.post('/api/prescriptions', { headers: u, data: { fileName: 'r.pdf' } })).json();
      await addItem(request, u, 'M4', 2); u.rx = rx.id;
    }
    const res = await Promise.all(users.map(u => request.post('/api/orders', { headers: { 'x-user-id': u['x-user-id'] }, data: { paymentMethod: 'UPI', prescriptionId: u.rx } })));
    const ok = res.filter(r => r.status() === 201).length;
    expect(ok).toBeLessThanOrEqual(2);
    expect((await (await request.get('/api/medicines/M4')).json()).stock).toBe(5 - ok * 2);
  });
});
