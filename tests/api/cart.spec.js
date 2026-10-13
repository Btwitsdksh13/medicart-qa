const { test, expect, addItem } = require('../helpers');
test.describe('Cart & coupons', () => {
  test('requires auth header', async ({ request }) => {
    expect((await request.get('/api/cart')).status()).toBe(401);
  });
  test('add item and compute totals with delivery fee', async ({ request, user }) => {
    const b = await (await addItem(request, user, 'M1', 2)).json();
    expect(b.subtotal).toBe(60); expect(b.delivery).toBe(40); expect(b.total).toBe(100);
  });
  test('free delivery at 500+', async ({ request, user }) => {
    const b = await (await addItem(request, user, 'M2', 5)).json(); // 600
    expect(b.delivery).toBe(0); expect(b.total).toBe(600);
  });
  test('delivery fee boundary: 499 pays fee, 500 is free', async ({ request, user }) => {
    await addItem(request, user, 'M2', 4); // 480 -> fee
    expect((await (await request.get('/api/cart', { headers: user })).json()).delivery).toBe(40);
    await addItem(request, user, 'M1', 1); // 510 -> free
    expect((await (await request.get('/api/cart', { headers: user })).json()).delivery).toBe(0);
  });
  test('adding same item merges quantity', async ({ request, user }) => {
    await addItem(request, user, 'M1', 2);
    const b = await (await addItem(request, user, 'M1', 3)).json();
    expect(b.items).toHaveLength(1); expect(b.items[0].qty).toBe(5);
  });
  for (const qty of [0, -1, 11, 1.5, 'a']) {
    test(`rejects invalid qty ${JSON.stringify(qty)}`, async ({ request, user }) => {
      const r = await addItem(request, user, 'M1', qty);
      expect(r.status()).toBe(400); expect((await r.json()).error).toBe('INVALID_QTY');
    });
  }
  test('out-of-stock medicine cannot be added', async ({ request, user }) => {
    const r = await addItem(request, user, 'M5');
    expect(r.status()).toBe(409); expect((await r.json()).error).toBe('OUT_OF_STOCK');
  });
  test('cannot exceed available stock across multiple adds', async ({ request, user }) => {
    await addItem(request, user, 'M4', 4);
    const r = await addItem(request, user, 'M4', 2);
    expect(r.status()).toBe(409); expect((await r.json()).error).toBe('INSUFFICIENT_STOCK');
  });
  test('percent coupon applies discount', async ({ request, user }) => {
    await addItem(request, user, 'M2', 2); // 240
    const b = await (await request.post('/api/cart/coupon', { headers: user, data: { code: 'health10' } })).json();
    expect(b.discount).toBe(24); expect(b.total).toBe(216 + 40);
  });
  test('flat coupon enforces minimum order', async ({ request, user }) => {
    await addItem(request, user, 'M1', 2);
    const r = await request.post('/api/cart/coupon', { headers: user, data: { code: 'FLAT50' } });
    expect(r.status()).toBe(422); expect((await r.json()).error).toBe('MIN_ORDER_NOT_MET');
  });
  test('expired and invalid coupons rejected', async ({ request, user }) => {
    await addItem(request, user, 'M2', 2);
    expect((await request.post('/api/cart/coupon', { headers: user, data: { code: 'EXPIRED20' } })).status()).toBe(410);
    expect((await request.post('/api/cart/coupon', { headers: user, data: { code: 'WHAT' } })).status()).toBe(404);
  });
  test('removing last item clears coupon', async ({ request, user }) => {
    await addItem(request, user, 'M2', 2);
    await request.post('/api/cart/coupon', { headers: user, data: { code: 'HEALTH10' } });
    const b = await (await request.delete('/api/cart/items/M2', { headers: user })).json();
    expect(b.coupon).toBeNull(); expect(b.total).toBe(0);
  });
  test('carts are isolated between users', async ({ request, user }) => {
    await addItem(request, user, 'M1');
    const other = await (await request.get('/api/cart', { headers: { 'x-user-id': 'someone-else' } })).json();
    expect(other.items).toHaveLength(0);
  });
});
