# MediCart – E-Pharmacy QA Automation Platform

End-to-end test automation for a mock e-pharmacy (search → cart → coupons → Rx validation → checkout → order lifecycle), inspired by real healthcare-commerce domain rules. The system under test is a self-contained mock; no proprietary code or data is used.

## What is covered (79 automated tests)
| Service | Examples |
|---|---|
| Pharmacy orders | totals & delivery boundary, coupon rules, qty limits, Rx enforcement, payment-failure rollback, idempotent orders, ownership/403, order state machine, cancel → stock restore + refund, concurrent checkout (no overselling) |
| Diagnostics | slot capacity, full-slot rejection, fasting note, collection fee rules, input validation, sample→report lifecycle, cancel frees slot |
| Doctor consult | speciality filter, double-booking prevention, validation, cancel + refund, **cross-service:** consult prescription unlocks Rx order |
| AI assistant | intent routing, answers grounded in real order/stock data, privacy (no cross-user leakage), **safety guardrails** (dosage refusal, emergency escalation) |
| Contract | JSON-schema (Ajv) for medicines, orders, uniform error shape |
| UI E2E (Playwright, Page Object) | purchase journey, Rx gate, OOS, bad coupon, UI↔backend consistency |

## Design
- Isolated state per test (reset endpoint + per-test user fixture) → deterministic, no ordering dependence.
- Layers: API tests for rules, contract tests for schema stability, few UI tests for journeys (test pyramid).
- CI: GitHub Actions matrix (API+contract / UI) on push, PR and nightly; HTML + JUnit reports uploaded as artifacts.
- Validated the suite by mutation: injected 8 bugs (stock not decremented, wrong delivery threshold, expired coupon accepted, ownership check removed, slot not freed, double booking, emergency/dosage guardrails removed) and confirmed the suite catches each.

## Run
```
npm install
npx playwright install chromium
npm test            # starts the app automatically
npx playwright show-report
docker build -t medicart . && docker run -p 3000:3000 medicart
```
