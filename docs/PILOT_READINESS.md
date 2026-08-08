# Monitoring & pilot readiness

Further research tracks for pilot blockers: [research/05_FURTHER_RESEARCH_ROADMAP.md](./research/05_FURTHER_RESEARCH_ROADMAP.md) (Tracks A–B).

## Health

- `GET /health` → `{ ok: true, service: "ripspricex-api" }`
- `npm run accept` — entitlement lock/unlock, inbox CRUD, uninstall pause policy

## Logs to watch

| Signal | Where |
|--------|--------|
| Smart Pricing routes mounted | API boot |
| Background jobs started | API boot |
| Launch 402 | unpaid create/launch (expected) |
| Launch validation errors | plan → price test mapping |
| Uninstall | webhook + `/api/shops/uninstall` |
| Cart transform readiness | Setup page / checkout-readiness |

## Pilot checklist

- [ ] Partner app linked (`client_id` set)
- [ ] App Pricing plan active on pilot shop
- [ ] Theme app embed enabled
- [ ] Cart transform deployed (Plus/dev)
- [ ] Create → Launch → PDP paint → Stop → Apply winner
- [ ] Uninstall pauses running tests
- [ ] RipX repo unchanged

## Env reference

See `.env.example` for `DATABASE_URL`, `RIPSPRICEX_API_PORT`, `RIPSPRICEX_DEV_ENTITLE_ALL`, Shopify keys.
