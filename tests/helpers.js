const { test: base, expect } = require('@playwright/test');
// Each test gets a fresh, isolated backend state + unique user.
const test = base.extend({
  user: async ({ request }, use, info) => {
    await request.post('/api/test/reset');
    await use({ 'x-user-id': 'u-' + info.workerIndex + '-' + Date.now() });
  },
});
const addItem = (request, user, medicineId, qty = 1) => request.post('/api/cart/items', { headers: user, data: { medicineId, qty } });
module.exports = { test, expect, addItem };
