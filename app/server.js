const express = require('express');
const path = require('path');
const crypto = require('crypto');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  const seedMedicines = () => ([
    { id: 'M1', name: 'Paracetamol 500mg', price: 30, stock: 100, rxRequired: false },
    { id: 'M2', name: 'Vitamin C 500mg', price: 120, stock: 50, rxRequired: false },
    { id: 'M3', name: 'Amoxicillin 500mg', price: 90, stock: 20, rxRequired: true },
    { id: 'M4', name: 'Azithromycin 250mg', price: 150, stock: 5, rxRequired: true },
    { id: 'M5', name: 'Cetirizine 10mg', price: 45, stock: 0, rxRequired: false },
  ]);
  const coupons = {
    HEALTH10: { type: 'percent', value: 10, minOrder: 100 },
    FLAT50: { type: 'flat', value: 50, minOrder: 300 },
    EXPIRED20: { type: 'percent', value: 20, minOrder: 0, expired: true },
  };
  const FLOW = { PLACED: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['PACKED', 'CANCELLED'], PACKED: ['SHIPPED'], SHIPPED: ['DELIVERED'], DELIVERED: [], CANCELLED: [] };

  let medicines, carts, orders, idem, prescriptions;
  const reset = () => { medicines = seedMedicines(); carts = {}; orders = {}; idem = {}; prescriptions = {}; if (typeof seedDiag === 'function') { seedDiag(); seedConsult(); } };

  const err = (res, code, error, message) => res.status(code).json({ error, message });
  const auth = (req, res, next) => {
    const u = req.header('x-user-id');
    if (!u) return err(res, 401, 'UNAUTHORIZED', 'x-user-id header required');
    req.user = u; next();
  };
  const cartOf = (u) => (carts[u] = carts[u] || { items: [], coupon: null });
  const totals = (cart) => {
    const subtotal = cart.items.reduce((s, i) => s + medicines.find(m => m.id === i.medicineId).price * i.qty, 0);
    let discount = 0;
    if (cart.coupon) {
      const c = coupons[cart.coupon];
      discount = c.type === 'percent' ? Math.round(subtotal * c.value / 100) : c.value;
    }
    const delivery = subtotal - discount >= 500 || subtotal === 0 ? 0 : 40;
    return { subtotal, discount, delivery, total: Math.max(subtotal - discount, 0) + delivery };
  };
  const cartView = (cart) => ({ items: cart.items.map(i => ({ ...i, ...(({ name, price, rxRequired }) => ({ name, price, rxRequired }))(medicines.find(m => m.id === i.medicineId)) })), coupon: cart.coupon, ...totals(cart) });

  app.post('/api/test/reset', (req, res) => { reset(); res.json({ ok: true }); });


  // ---------- Diagnostics ----------
  const labTests = [
    { id: 'T1', name: 'CBC (Complete Blood Count)', price: 350, fasting: false },
    { id: 'T2', name: 'Lipid Profile', price: 600, fasting: true },
    { id: 'T3', name: 'HbA1c', price: 500, fasting: false },
  ];
  let slots, bookings;
  const seedDiag = () => { slots = {}; bookings = {}; ['2026-11-01', '2026-11-02'].forEach(d => ['07:00', '09:00', '11:00'].forEach(t => { slots[d + 'T' + t] = { slot: d + 'T' + t, capacity: t === '11:00' ? 1 : 3, booked: 0 }; })); };
  app.get('/api/diagnostics/tests', (req, res) => res.json({ items: labTests }));
  app.get('/api/diagnostics/slots', (req, res) => {
    const d = req.query.date; const list = Object.values(slots).filter(x => (!d || x.slot.startsWith(d)) && x.booked < x.capacity);
    res.json({ items: list.map(x => ({ slot: x.slot, remaining: x.capacity - x.booked })) });
  });
  app.post('/api/diagnostics/bookings', auth, (req, res) => {
    const { testIds, slot, address, patientAge } = req.body || {};
    if (!Array.isArray(testIds) || !testIds.length) return err(res, 400, 'NO_TESTS', 'Select at least one test');
    const tests = testIds.map(id => labTests.find(t => t.id === id));
    if (tests.some(t => !t) || new Set(testIds).size !== testIds.length) return err(res, 400, 'INVALID_TESTS', 'Unknown or duplicate test');
    if (!address || !/^[1-9][0-9]{5}$/.test(String(address.pincode || ''))) return err(res, 400, 'INVALID_PINCODE', '6-digit pincode required');
    if (!Number.isInteger(patientAge) || patientAge < 0 || patientAge > 120) return err(res, 400, 'INVALID_AGE', 'age 0-120');
    const sl = slots[slot];
    if (!sl) return err(res, 404, 'SLOT_NOT_FOUND', 'Slot not found');
    if (sl.booked >= sl.capacity) return err(res, 409, 'SLOT_FULL', 'Slot is full');
    sl.booked++;
    const amount = tests.reduce((s, t) => s + t.price, 0);
    const id = 'DGN' + crypto.randomBytes(3).toString('hex').toUpperCase();
    bookings[id] = { id, user: req.user, testIds, slot, amount, collectionFee: amount >= 500 ? 0 : 100, fastingInstruction: tests.some(t => t.fasting) ? 'Fast 10-12 hours before sample' : null, status: 'BOOKED' };
    res.status(201).json(bookings[id]);
  });
  const DFLOW = { BOOKED: ['SAMPLE_COLLECTED', 'CANCELLED'], SAMPLE_COLLECTED: ['REPORT_READY'], REPORT_READY: [], CANCELLED: [] };
  app.post('/api/diagnostics/bookings/:id/status', auth, (req, res) => {
    const b = bookings[req.params.id]; if (!b) return err(res, 404, 'NOT_FOUND', 'Booking not found');
    if (b.user !== req.user) return err(res, 403, 'FORBIDDEN', 'Not your booking');
    const n = (req.body || {}).status;
    if (!DFLOW[b.status].includes(n)) return err(res, 409, 'INVALID_TRANSITION', `${b.status} -> ${n} not allowed`);
    if (n === 'CANCELLED') slots[b.slot].booked--;
    b.status = n; res.json(b);
  });
  app.get('/api/diagnostics/bookings/:id', auth, (req, res) => {
    const b = bookings[req.params.id]; if (!b) return err(res, 404, 'NOT_FOUND', 'Booking not found');
    if (b.user !== req.user) return err(res, 403, 'FORBIDDEN', 'Not your booking');
    res.json(b);
  });

  // ---------- Doctor consultation ----------
  const doctors = [
    { id: 'D1', name: 'Dr. Mehta', speciality: 'General Physician', fee: 300, slots: ['10:00', '10:15', '10:30'] },
    { id: 'D2', name: 'Dr. Rao', speciality: 'Dermatologist', fee: 500, slots: ['16:00', '16:30'] },
  ];
  let consults;
  const seedConsult = () => { consults = {}; };
  const taken = (d, t) => Object.values(consults).some(c => c.doctorId === d && c.time === t && c.status !== 'CANCELLED');
  app.get('/api/doctors', (req, res) => {
    const sp = (req.query.speciality || '').toLowerCase();
    res.json({ items: doctors.filter(d => d.speciality.toLowerCase().includes(sp)).map(d => ({ ...d, availableSlots: d.slots.filter(t => !taken(d.id, t)) })) });
  });
  app.post('/api/consultations', auth, (req, res) => {
    const { doctorId, time, mode, symptoms } = req.body || {};
    const d = doctors.find(x => x.id === doctorId);
    if (!d) return err(res, 404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
    if (!['VIDEO', 'AUDIO', 'CHAT'].includes(mode)) return err(res, 400, 'INVALID_MODE', 'VIDEO/AUDIO/CHAT');
    if (!symptoms || String(symptoms).trim().length < 5) return err(res, 400, 'SYMPTOMS_REQUIRED', 'Describe symptoms (min 5 chars)');
    if (!d.slots.includes(time)) return err(res, 400, 'INVALID_SLOT', 'Doctor does not work this slot');
    if (taken(doctorId, time)) return err(res, 409, 'SLOT_TAKEN', 'Slot already booked');
    const id = 'CNS' + crypto.randomBytes(3).toString('hex').toUpperCase();
    consults[id] = { id, user: req.user, doctorId, time, mode, symptoms, fee: d.fee, status: 'SCHEDULED', prescriptionId: null };
    res.status(201).json(consults[id]);
  });
  app.post('/api/consultations/:id/complete', auth, (req, res) => {
    const c = consults[req.params.id]; if (!c) return err(res, 404, 'NOT_FOUND', 'Consultation not found');
    if (c.status !== 'SCHEDULED') return err(res, 409, 'INVALID_TRANSITION', `${c.status} cannot be completed`);
    const rxId = 'RX' + crypto.randomBytes(3).toString('hex');
    prescriptions[rxId] = { id: rxId, user: c.user, fileName: 'consult-' + c.id + '.pdf' };
    c.status = 'COMPLETED'; c.prescriptionId = rxId; res.json(c);
  });
  app.post('/api/consultations/:id/cancel', auth, (req, res) => {
    const c = consults[req.params.id]; if (!c) return err(res, 404, 'NOT_FOUND', 'Consultation not found');
    if (c.user !== req.user) return err(res, 403, 'FORBIDDEN', 'Not your consultation');
    if (c.status !== 'SCHEDULED') return err(res, 409, 'INVALID_TRANSITION', `${c.status} cannot be cancelled`);
    c.status = 'CANCELLED'; c.refund = c.fee; res.json(c);
  });

  // ---------- AI health assistant (rule-based mock with guardrails) ----------
  app.post('/api/chatbot/message', auth, (req, res) => {
    const text = String((req.body || {}).message || '').trim();
    if (!text) return err(res, 400, 'EMPTY_MESSAGE', 'message required');
    if (text.length > 500) return err(res, 400, 'MESSAGE_TOO_LONG', 'max 500 chars');
    const t = text.toLowerCase();
    if (/chest pain|can'?t breathe|suicid|overdose|unconscious/.test(t))
      return res.json({ intent: 'EMERGENCY', escalated: true, reply: 'This may be an emergency. Please call 112 or go to the nearest hospital immediately.' });
    if (/dose|dosage|how many (tablets|mg)|kitni (goli|tablet)|without (a )?prescription|(take|mix|combine).*(alcohol|with other medicine)|interaction|what disease|which disease|diagnos(e|is) me|kya bimari/.test(t)) {
      if (process.env.BOT_FAULT === 'unsafe') return res.json({ intent: 'ANSWER', reply: 'Take 2 tablets of 500 mg every 4 hours.' });
      return res.json({ intent: 'MEDICAL_ADVICE_BLOCKED', escalated: false, reply: 'I cannot advise on dosage. Please consult a doctor.', suggestedAction: 'BOOK_CONSULTATION' });
    }
    const ord = t.match(/ord[0-9a-f]{8}/i);
    if (/(order|delivery).*(status|where|track|kahan|kab)|where.*order|track.*order/.test(t)) {
      if (!ord) return res.json({ intent: 'ORDER_STATUS', reply: 'Please share your order ID (e.g. ORDXXXXXXXX).' });
      const o = orders[ord[0].toUpperCase()];
      if (!o || (o.user !== req.user && process.env.BOT_FAULT !== 'leak')) return res.json({ intent: 'ORDER_STATUS', reply: 'I could not find that order on your account.' });
      if (process.env.BOT_FAULT === 'hallucinate') return res.json({ intent: 'ORDER_STATUS', reply: `Your order ${o.id} is DELIVERED.`, data: { status: 'DELIVERED' } });
      return res.json({ intent: 'ORDER_STATUS', reply: `Your order ${o.id} is ${o.status}.`, data: { status: o.status } });
    }
    const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)); return d[a.length][b.length]; };
    const words = t.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3);
    const med = medicines.find(m => { const k = m.name.split(' ')[0].toLowerCase(); return t.includes(k) || words.some(w => lev(w, k) <= 2); });
    if (/(avail|stock|have|hai kya)/.test(t) && med)
      return res.json({ intent: 'MEDICINE_AVAILABILITY', reply: med.stock > 0 ? `${med.name} is in stock.` : `${med.name} is currently out of stock.`, data: { inStock: med.stock > 0 } });
    if (/(book|schedule).*(test|blood|diagnos)|lab test|blood test|test book/.test(t))
      return res.json({ intent: 'BOOK_DIAGNOSTICS', reply: 'Sure, pick a test and a slot.', suggestedAction: 'OPEN_DIAGNOSTICS' });
    if (/(doctor|consult)|(fever|headache|rash|cough|symptom)/.test(t))
      return res.json({ intent: 'BOOK_CONSULTATION', reply: 'I can help you book a doctor consultation.', suggestedAction: 'OPEN_CONSULTATION' });
    res.json({ intent: 'FALLBACK', reply: "Sorry, I didn't get that. I can help with orders, medicines, lab tests and doctor consults.", escalated: false });
  });

  reset();
  app.get('/api/medicines', (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    let list = medicines.filter(m => m.name.toLowerCase().includes(q));
    if (req.query.rx === 'true') list = list.filter(m => m.rxRequired);
    if (req.query.rx === 'false') list = list.filter(m => !m.rxRequired);
    if (req.query.inStock === 'true') list = list.filter(m => m.stock > 0);
    res.json({ count: list.length, items: list });
  });
  app.get('/api/medicines/:id', (req, res) => {
    const m = medicines.find(x => x.id === req.params.id);
    return m ? res.json(m) : err(res, 404, 'NOT_FOUND', 'Medicine not found');
  });

  app.post('/api/prescriptions', auth, (req, res) => {
    const { fileName } = req.body || {};
    if (!fileName || !/\.(jpg|jpeg|png|pdf)$/i.test(fileName)) return err(res, 400, 'INVALID_PRESCRIPTION', 'jpg/png/pdf required');
    const id = 'RX' + crypto.randomBytes(3).toString('hex');
    prescriptions[id] = { id, user: req.user, fileName };
    res.status(201).json({ id, fileName });
  });

  app.get('/api/cart', auth, (req, res) => res.json(cartView(cartOf(req.user))));
  app.post('/api/cart/items', auth, (req, res) => {
    const { medicineId, qty } = req.body || {};
    const m = medicines.find(x => x.id === medicineId);
    if (!m) return err(res, 404, 'NOT_FOUND', 'Medicine not found');
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) return err(res, 400, 'INVALID_QTY', 'qty must be integer 1-10');
    if (m.stock === 0) return err(res, 409, 'OUT_OF_STOCK', `${m.name} is out of stock`);
    const cart = cartOf(req.user);
    const ex = cart.items.find(i => i.medicineId === medicineId);
    const newQty = (ex ? ex.qty : 0) + qty;
    if (newQty > m.stock) return err(res, 409, 'INSUFFICIENT_STOCK', `Only ${m.stock} left`);
    if (newQty > 10) return err(res, 400, 'INVALID_QTY', 'max 10 per medicine');
    if (ex) ex.qty = newQty; else cart.items.push({ medicineId, qty });
    res.status(201).json(cartView(cart));
  });
  app.delete('/api/cart/items/:id', auth, (req, res) => {
    const cart = cartOf(req.user);
    cart.items = cart.items.filter(i => i.medicineId !== req.params.id);
    if (!cart.items.length) cart.coupon = null;
    res.json(cartView(cart));
  });
  app.post('/api/cart/coupon', auth, (req, res) => {
    const code = ((req.body || {}).code || '').toUpperCase();
    const c = coupons[code];
    if (!c) return err(res, 404, 'INVALID_COUPON', 'Coupon not found');
    if (c.expired) return err(res, 410, 'COUPON_EXPIRED', 'Coupon expired');
    const cart = cartOf(req.user);
    const sub = totals({ ...cart, coupon: null }).subtotal;
    if (sub < c.minOrder) return err(res, 422, 'MIN_ORDER_NOT_MET', `Minimum order ${c.minOrder}`);
    cart.coupon = code;
    res.json(cartView(cart));
  });

  app.post('/api/orders', auth, (req, res) => {
    const key = req.header('idempotency-key');
    if (key && idem[req.user + key]) return res.status(200).json(orders[idem[req.user + key]]);
    const { prescriptionId, paymentMethod, simulatePaymentFailure } = req.body || {};
    const cart = cartOf(req.user);
    if (!cart.items.length) return err(res, 400, 'EMPTY_CART', 'Cart is empty');
    if (!['UPI', 'CARD', 'COD'].includes(paymentMethod)) return err(res, 400, 'INVALID_PAYMENT', 'UPI/CARD/COD only');
    const needsRx = cart.items.some(i => medicines.find(m => m.id === i.medicineId).rxRequired);
    if (needsRx && !(prescriptionId && prescriptions[prescriptionId] && prescriptions[prescriptionId].user === req.user))
      return err(res, 422, 'PRESCRIPTION_REQUIRED', 'Valid prescription needed for Rx medicines');
    for (const i of cart.items) {
      const m = medicines.find(x => x.id === i.medicineId);
      if (m.stock < i.qty) return err(res, 409, 'INSUFFICIENT_STOCK', `${m.name}: only ${m.stock} left`);
    }
    if (simulatePaymentFailure && paymentMethod !== 'COD') return err(res, 402, 'PAYMENT_FAILED', 'Payment declined');
    cart.items.forEach(i => { medicines.find(x => x.id === i.medicineId).stock -= i.qty; });
    const t = totals(cart);
    const id = 'ORD' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const order = { id, user: req.user, status: 'PLACED', paymentMethod, paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PAID', items: cartView(cart).items, ...(({ subtotal, discount, delivery, total }) => ({ subtotal, discount, delivery, total }))(t), history: [{ status: 'PLACED', at: new Date().toISOString() }] };
    orders[id] = order;
    if (key) idem[req.user + key] = id;
    carts[req.user] = { items: [], coupon: null };
    res.status(201).json(order);
  });
  app.get('/api/orders/:id', auth, (req, res) => {
    const o = orders[req.params.id];
    if (!o) return err(res, 404, 'NOT_FOUND', 'Order not found');
    if (o.user !== req.user) return err(res, 403, 'FORBIDDEN', 'Not your order');
    res.json(o);
  });
  app.post('/api/orders/:id/status', auth, (req, res) => {
    const o = orders[req.params.id];
    if (!o) return err(res, 404, 'NOT_FOUND', 'Order not found');
    const next = (req.body || {}).status;
    if (!FLOW[next] && !(next in FLOW)) return err(res, 400, 'INVALID_STATUS', 'Unknown status');
    if (!FLOW[o.status].includes(next)) return err(res, 409, 'INVALID_TRANSITION', `${o.status} -> ${next} not allowed`);
    if (next === 'CANCELLED') o.items.forEach(i => { medicines.find(m => m.id === i.medicineId).stock += i.qty; if (o.paymentStatus === 'PAID') o.paymentStatus = 'REFUND_INITIATED'; });
    o.status = next; o.history.push({ status: next, at: new Date().toISOString() });
    res.json(o);
  });
  return app;
}
module.exports = { createApp };
if (require.main === module) createApp().listen(process.env.PORT || 3000, () => console.log('MediCart on', process.env.PORT || 3000));
