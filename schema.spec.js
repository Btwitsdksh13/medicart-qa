const Ajv = require('ajv');
const { test, expect, addItem } = require('../helpers');
const ajv = new Ajv({ allErrors: true });
const medicine = { type: 'object', required: ['id', 'name', 'price', 'stock', 'rxRequired'], properties: { id: { type: 'string' }, name: { type: 'string' }, price: { type: 'number', minimum: 0 }, stock: { type: 'integer', minimum: 0 }, rxRequired: { type: 'boolean' } }, additionalProperties: false };
const order = { type: 'object', required: ['id', 'status', 'paymentStatus', 'items', 'subtotal', 'discount', 'delivery', 'total', 'history'], properties: { id: { type: 'string', pattern: '^ORD[0-9A-F]{8}$' }, status: { enum: ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] }, paymentStatus: { enum: ['PAID', 'PENDING', 'REFUND_INITIATED'] }, total: { type: 'number', minimum: 0 }, items: { type: 'array', minItems: 1 }, history: { type: 'array', minItems: 1 } } };
const errorShape = { type: 'object', required: ['error', 'message'], properties: { error: { type: 'string' }, message: { type: 'string' } } };
const check = (schema, data) => { const v = ajv.compile(schema); expect(v(data), JSON.stringify(v.errors)).toBe(true); };
test.describe('API contract', () => {
  test('medicine list items match schema', async ({ request, user }) => {
    const b = await (await request.get('/api/medicines')).json();
    for (const m of b.items) check(medicine, m);
  });
  test('order response matches schema', async ({ request, user }) => {
    await addItem(request, user, 'M1');
    check(order, await (await request.post('/api/orders', { headers: user, data: { paymentMethod: 'UPI' } })).json());
  });
  test('all error responses share {error,message} shape', async ({ request, user }) => {
    const rs = [await request.get('/api/medicines/X'), await request.get('/api/cart'), await addItem(request, user, 'M5'), await request.post('/api/orders', { headers: user, data: {} })];
    for (const r of rs) { expect(r.status()).toBeGreaterThanOrEqual(400); check(errorShape, await r.json()); }
  });
});
