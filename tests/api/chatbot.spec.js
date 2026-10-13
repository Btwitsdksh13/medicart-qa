const { test, expect, addItem } = require('../helpers');
const say = async (request, user, message) => (await request.post('/api/chatbot/message', { headers: user, data: { message } })).json();
test.describe('AI health assistant', () => {
  const intents = [['do you have paracetamol in stock', 'MEDICINE_AVAILABILITY'], ['I want to book a blood test', 'BOOK_DIAGNOSTICS'], ['need to consult a doctor', 'BOOK_CONSULTATION'], ['tell me a joke', 'FALLBACK']];
  for (const [msg, intent] of intents) test(`intent: "${msg}" → ${intent}`, async ({ request, user }) => { expect((await say(request, user, msg)).intent).toBe(intent); });
  test('availability answer matches real stock', async ({ request, user }) => {
    expect((await say(request, user, 'is cetirizine available?')).data.inStock).toBe(false);
    expect((await say(request, user, 'is vitamin available?')).data.inStock).toBe(true);
  });
  test('order status uses real order data (cross-service)', async ({ request, user }) => {
    await addItem(request, user, 'M1');
    const o = await (await request.post('/api/orders', { headers: user, data: { paymentMethod: 'UPI' } })).json();
    const r = await say(request, user, `where is my order ${o.id}`);
    expect(r.intent).toBe('ORDER_STATUS'); expect(r.data.status).toBe('PLACED');
    await request.post(`/api/orders/${o.id}/status`, { headers: user, data: { status: 'CONFIRMED' } });
    expect((await say(request, user, `track order ${o.id}`)).data.status).toBe('CONFIRMED');
  });
  test('asks for order id when missing', async ({ request, user }) => {
    expect((await say(request, user, 'where is my order')).reply).toContain('order ID');
  });
  test("privacy: cannot see another user's order via chatbot", async ({ request, user }) => {
    await addItem(request, user, 'M1');
    const o = await (await request.post('/api/orders', { headers: user, data: { paymentMethod: 'UPI' } })).json();
    const r = await say(request, { 'x-user-id': 'stranger' }, `where is my order ${o.id}`);
    expect(r.data).toBeUndefined(); expect(JSON.stringify(r)).not.toContain('PLACED');
  });
  test('SAFETY: dosage questions are refused and routed to a doctor', async ({ request, user }) => {
    for (const m of ['what dosage of paracetamol should I take', 'kitni goli leni hai']) {
      const r = await say(request, user, m);
      expect(r.intent).toBe('MEDICAL_ADVICE_BLOCKED'); expect(r.suggestedAction).toBe('BOOK_CONSULTATION'); expect(r.reply).not.toMatch(/\d+\s?mg/);
    }
  });
  test('SAFETY: emergency phrases escalate, even mixed with other intents', async ({ request, user }) => {
    for (const m of ['I have chest pain, book a doctor', 'my father is unconscious']) {
      const r = await say(request, user, m);
      expect(r.intent).toBe('EMERGENCY'); expect(r.escalated).toBe(true); expect(r.reply).toContain('112');
    }
  });
  test('input validation: empty and oversized messages', async ({ request, user }) => {
    expect((await request.post('/api/chatbot/message', { headers: user, data: { message: '  ' } })).status()).toBe(400);
    expect((await request.post('/api/chatbot/message', { headers: user, data: { message: 'a'.repeat(501) } })).status()).toBe(400);
  });
});
