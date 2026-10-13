const { test, expect } = require('../helpers');
test.describe('Catalog & search', () => {
  test('search is case-insensitive and partial', async ({ request, user }) => {
    const r = await request.get('/api/medicines?q=PARACET');
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.count).toBe(1); expect(b.items[0].id).toBe('M1');
  });
  test('filter Rx-only medicines', async ({ request, user }) => {
    const b = await (await request.get('/api/medicines?rx=true')).json();
    expect(b.items.length).toBeGreaterThan(0);
    for (const m of b.items) expect(m.rxRequired).toBe(true);
  });
  test('inStock filter hides out-of-stock', async ({ request, user }) => {
    const b = await (await request.get('/api/medicines?inStock=true')).json();
    expect(b.items.find(m => m.id === 'M5')).toBeUndefined();
  });
  test('unknown medicine returns 404 with error code', async ({ request, user }) => {
    const r = await request.get('/api/medicines/NOPE');
    expect(r.status()).toBe(404); expect((await r.json()).error).toBe('NOT_FOUND');
  });
});
