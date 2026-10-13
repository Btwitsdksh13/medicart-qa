const { test, expect } = require('@playwright/test');
// Page object
class MediCart {
  constructor(page) { this.page = page; }
  async open() { await this.page.request.post('/api/test/reset'); await this.page.goto('/'); }
  async search(q) { await this.page.getByTestId('search').fill(q); await this.page.getByTestId('search-btn').click(); }
  add(id) { return this.page.getByTestId('add-' + id).click(); }
  async coupon(c) { await this.page.getByTestId('coupon-input').fill(c); await this.page.getByTestId('apply-coupon').click(); }
  get msg() { return this.page.getByTestId('msg'); }
  get total() { return this.page.getByTestId('total'); }
  checkout() { return this.page.getByTestId('checkout').click(); }
}
test.describe('E2E customer journeys', () => {
  test('search → add → coupon → checkout', async ({ page }) => {
    const app = new MediCart(page); await app.open();
    await app.search('vitamin'); await expect(page.getByTestId('med-M1')).toHaveCount(0);
    await app.add('M2'); await app.add('M2');
    await expect(app.total).toHaveText('Total: 280'); // 240 + 40 delivery
    await app.coupon('HEALTH10');
    await expect(page.getByTestId('discount')).toHaveText('Discount: 24');
    await expect(app.total).toHaveText('Total: 256');
    await app.checkout();
    await expect(page.getByTestId('order')).toContainText('PLACED');
    await expect(page.getByTestId('cart')).toHaveText('Empty');
  });
  test('Rx medicine shows badge and is blocked until prescription uploaded', async ({ page }) => {
    const app = new MediCart(page); await app.open();
    await app.search('amox');
    await expect(page.getByTestId('rx-badge')).toBeVisible();
    await app.add('M3'); await app.checkout();
    await expect(app.msg).toContainText('PRESCRIPTION_REQUIRED');
    await page.getByTestId('rx-upload').click();
    await expect(app.msg).toHaveText('Prescription uploaded');
    await app.checkout();
    await expect(page.getByTestId('order')).toContainText('PLACED');
  });
  test('out-of-stock medicine has no Add button', async ({ page }) => {
    const app = new MediCart(page); await app.open(); await app.search('cetirizine');
    await expect(page.getByTestId('med-M5')).toContainText('Out of stock');
    await expect(page.getByTestId('add-M5')).toHaveCount(0);
  });
  test('invalid coupon shows error and does not change total', async ({ page }) => {
    const app = new MediCart(page); await app.open();
    await app.add('M2'); await app.coupon('EXPIRED20');
    await expect(app.msg).toContainText('COUPON_EXPIRED');
    await expect(page.getByTestId('discount')).toHaveText('Discount: 0');
  });
  test('UI state agrees with backend after checkout (cross-layer check)', async ({ page, request }) => {
    const app = new MediCart(page); await app.open(); await app.add('M1');
    await app.checkout();
    await expect(page.getByTestId('order')).toContainText('ORD');
    const m = await (await request.get('/api/medicines/M1')).json();
    expect(m.stock).toBe(99);
  });
});
