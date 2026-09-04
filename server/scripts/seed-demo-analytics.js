#!/usr/bin/env node
/**
 * Fills running tests with plausible visitor and conversion data so the report
 * screens can be reviewed without waiting for real traffic.
 *
 * Every row it writes is tagged, so `--clear` removes exactly what it added and
 * nothing else. Real assignments and events are never touched.
 *
 *   node server/scripts/seed-demo-analytics.js --dry-run
 *   node server/scripts/seed-demo-analytics.js
 *   node server/scripts/seed-demo-analytics.js --clear
 *
 * Options:
 *   --visitors=N   visitors per variation for a full-length test (default 3000)
 *   --tests=N      only seed the first N running tests
 *   --shop=DOMAIN  restrict to one shop
 *   --srm=N        give N tests a broken traffic split (default 0)
 *   --stamp-floors write the sample/conversion floors onto seeded tests so the
 *                  readiness and winner gates engage (default off)
 * Winning arms rotate: control, variation 1, then variation 2 when the test
 * has three arms, so the experiment list shows mixed product outcomes.
 *   --clear        delete previously seeded rows and exit
 *   --dry-run      report what would be written, write nothing
 */

const path = require('node:path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/** Marks every synthetic visitor so the data stays separable from real traffic. */
const SEED_USER_PREFIX = 'demoseed';
const SEED_TAG = 'demo-analytics';
/** Goal key that records which tests had their floors written by this script. */
const SEED_FLOOR_MARKER = 'demo_seed_floors';

function parseArgs(argv) {
  const args = { visitors: 3000, tests: null, shop: null, srm: 0, clear: false, dryRun: false, stampFloors: false };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'clear') args.clear = true;
    else if (key === 'dry-run') args.dryRun = true;
    else if (key === 'stamp-floors') args.stampFloors = true;
    else if (key === 'visitors') args.visitors = Math.max(50, Number(value) || 3000);
    else if (key === 'tests') args.tests = Math.max(1, Number(value) || 1);
    else if (key === 'shop') args.shop = String(value || '').trim().toLowerCase();
    else if (key === 'srm') args.srm = Math.max(0, Number(value) || 0);
  }
  return args;
}

/** Deterministic PRNG so a rerun of the same test produces the same story. */
function makeRandom(seedText) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * Rotate a clear winner so neighbouring products do not all tell the same
 * story: control, variation 1, then variation 2 when the test has three arms.
 */
function pickWinner(index, armCount) {
  // Cycle over the arms the test actually has. A fixed modulo 3 gave two-arm
  // tests control, variation 1, variation 1: the back-to-back repetition this
  // is meant to avoid, and it handed variation 1 twice control's share of wins.
  const cycleLength = Math.min(3, Math.max(2, armCount));
  const cycle = index % cycleLength;
  if (cycle === 0) return { key: 'control_wins', winnerArm: 0 };
  if (cycle === 1) return { key: 'variant_1_wins', winnerArm: 1 };
  return { key: 'variant_2_wins', winnerArm: 2 };
}

function firstNumber(...values) {
  for (const raw of values) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Digs the fixed price out of a price-test variant config. */
function variantConfiguredPrice(variant) {
  const config = variant?.config || {};
  const direct = firstNumber(config.price);
  if (direct) return direct;
  const byProduct = config.byProduct || {};
  for (const product of Object.values(byProduct)) {
    for (const entry of Object.values(product?.byVariant || {})) {
      const price = firstNumber(entry?.price);
      if (price) return price;
    }
  }
  return null;
}

/**
 * Price actually paid on each arm. Price tests carry it on the variant; offer
 * tests carry a discount off the plan's catalog price.
 */
function resolveArmPrices(test, catalogPrice, random) {
  const variants = Array.isArray(test.variants) ? test.variants : [];
  const controlPrice =
    variantConfiguredPrice(variants[0]) ||
    catalogPrice ||
    // No stored price anywhere: invent a stable one so revenue is still coherent.
    Math.round((25 + random() * 250) * 100) / 100;
  return variants.map(variant => {
    const configured = variantConfiguredPrice(variant);
    if (configured) return configured;
    const discount = Number(variant?.config?.discount_value) || 0;
    const type = String(variant?.config?.discount_type || '').toLowerCase();
    if (discount > 0 && type === 'percent') {
      return Math.round(controlPrice * (1 - discount / 100) * 100) / 100;
    }
    if (discount > 0) return Math.max(0.01, Math.round((controlPrice - discount) * 100) / 100);
    return controlPrice;
  });
}

/**
 * Conversion rate per arm.
 *
 * Every arm sits on a common base rate of 2.2-2.8% and the designated winner is
 * lifted roughly to double it, so the gap clears the noise floor at the visitor
 * counts this script seeds and the winner gates actually resolve. Revenue per
 * visitor still turns on price, which resolveArmPrices supplies per arm.
 */
function resolveArmRates(armCount, winnerArm, random) {
  const baseRate = 0.022 + random() * 0.006;
  return Array.from({ length: armCount }, (_, index) => {
    if (winnerArm === 0) {
      return index === 0 ? baseRate * 2.1 : baseRate;
    }
    if (index === winnerArm) return baseRate * 2.2;
    return baseRate;
  });
}

function multinomialSplit(total, weights, random) {
  const sum = weights.reduce((acc, w) => acc + w, 0) || weights.length;
  const counts = weights.map(() => 0);
  for (let i = 0; i < total; i += 1) {
    let roll = random() * sum;
    for (let arm = 0; arm < weights.length; arm += 1) {
      roll -= weights[arm];
      if (roll <= 0) {
        counts[arm] += 1;
        break;
      }
    }
  }
  return counts;
}

function isoDay(ms) {
  return new Date(ms).toISOString();
}

async function clearSeed(pool) {
  const events = await pool.query(
    `DELETE FROM events WHERE metadata->>'seed' = $1 OR user_id LIKE $2`,
    [SEED_TAG, `${SEED_USER_PREFIX}_%`]
  );
  const assignments = await pool.query(`DELETE FROM test_assignments WHERE user_id LIKE $1`, [
    `${SEED_USER_PREFIX}_%`,
  ]);
  return { events: events.rowCount, assignments: assignments.rowCount };
}

async function loadRunningTests(pool, args) {
  const params = [];
  let where = "t.status = 'running'";
  if (args.shop) {
    params.push(args.shop);
    where += ` AND LOWER(TRIM(t.shop_domain)) = $${params.length}`;
  }
  let limit = '';
  if (args.tests) {
    params.push(args.tests);
    limit = ` LIMIT $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT t.id, t.shop_domain, t.type, t.name, t.started_at, t.created_at, t.variants, t.goal,
            p.plan_json->>'current_price' AS catalog_price
     FROM tests t
     LEFT JOIN smart_pricing_inbox_plans p
       ON p.test_id = t.id AND LOWER(TRIM(p.shop_domain)) = LOWER(TRIM(t.shop_domain))
     WHERE ${where}
     ORDER BY t.started_at NULLS LAST, t.created_at${limit}`,
    params
  );
  return rows;
}

function buildTestData(test, args, index) {
  const random = makeRandom(String(test.id));
  const variants = Array.isArray(test.variants) ? test.variants : [];
  if (variants.length < 2) return null;

  const picked = pickWinner(index, variants.length);
  const scenario = picked.key;
  const catalogPrice = firstNumber(test.catalog_price);
  const armPrices = resolveArmPrices(test, catalogPrice, random);
  const armRates = resolveArmRates(variants.length, picked.winnerArm, random);

  const startedAt = new Date(test.started_at || test.created_at || Date.now()).getTime();
  const now = Date.now();
  const windowMs = Math.max(3 * 86400000, now - startedAt);

  const perArm = args.visitors;
  const total = perArm * variants.length;

  const forceSrm = index < args.srm;
  const weights = variants.map((variant, arm) => {
    const allocation = Number(variant?.allocation) || 100 / variants.length;
    // A mismatch is modelled as extra traffic landing on control, which is what
    // a caching or bot problem usually looks like.
    if (forceSrm && arm === 0) return allocation * 1.7;
    return allocation;
  });
  const armVisitors = multinomialSplit(total, weights, random);

  const assignments = [];
  const events = [];
  const summary = [];
  const shop = String(test.shop_domain || '').trim().toLowerCase();
  const shortId = String(test.id).replace(/-/g, '').slice(0, 12);

  variants.forEach((variant, arm) => {
    const variantId = String(variant?.id ?? variant?.name ?? `arm-${arm}`);
    const variantName = String(variant?.name ?? variantId);
    const visitors = armVisitors[arm];
    const rate = armRates[arm];
    const price = armPrices[arm];
    let conversions = 0;
    let revenue = 0;

    for (let i = 0; i < visitors; i += 1) {
      const userId = `${SEED_USER_PREFIX}_${shortId}_${arm}_${i}`;
      const assignedAt = startedAt + Math.floor(random() * windowMs);
      assignments.push([test.id, userId, shop, variantId, variantName, isoDay(assignedAt)]);
      if (random() < rate) {
        // Orders land after the visit and never in the future, so conversion
        // windows and date filters behave the way they would on real data.
        const delay = Math.floor(random() * Math.min(2 * 86400000, Math.max(1, now - assignedAt)));
        const orderedAt = Math.min(now, assignedAt + delay);
        const basket = 1 + (random() < 0.18 ? 1 : 0);
        const value = Math.round(price * basket * (0.94 + random() * 0.12) * 100) / 100;
        conversions += 1;
        revenue += value;
        events.push([
          test.id,
          variantId,
          userId,
          shop,
          'conversion',
          null,
          value.toFixed(2),
          JSON.stringify({ seed: SEED_TAG, order_id: `${SEED_USER_PREFIX}-${shortId}-${arm}-${i}` }),
          isoDay(orderedAt),
        ]);
      }
    }
    summary.push({
      variantName,
      visitors,
      conversions,
      rate: visitors > 0 ? (conversions / visitors) * 100 : 0,
      rpv: visitors > 0 ? revenue / visitors : 0,
      price,
    });
  });

  return { scenario, forceSrm, assignments, events, summary };
}

async function insertRows(client, table, columns, rows) {
  // Postgres caps a statement at 65535 bind parameters, so the batch size has
  // to be derived from the column count rather than fixed.
  const chunkSize = Math.max(1, Math.floor(60000 / columns.length));
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = [];
    const placeholders = chunk
      .map(row => {
        const slots = row.map(value => {
          values.push(value);
          return `$${values.length}`;
        });
        return `(${slots.join(', ')})`;
      })
      .join(', ');
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      values
    );
  }
}

async function stampFloors(client, testIds, visitorsPerArm) {
  // The readiness and winner gates only engage on tests that stored a floor.
  // These tests predate those fields, so seeding traffic alone leaves every
  // report sitting in "collecting evidence" with no winner ever called.
  const floor = Math.max(50, Math.round(visitorsPerArm * 0.6));
  const conversions = Math.max(10, Math.round(floor * 0.02));
  const { rowCount } = await client.query(
    `UPDATE tests
     SET goal = COALESCE(goal, '{}'::jsonb) || jsonb_build_object(
           'min_sample_size', $2::int,
           'min_conversions_per_variation', $3::int,
           $4::text, true
         )
     WHERE id = ANY($1::uuid[])`,
    [testIds, floor, conversions, SEED_FLOOR_MARKER]
  );
  return { floor, conversions, rowCount };
}

/** Strips only the floors this script added, identified by its own marker. */
async function clearStampedFloors(pool) {
  const { rowCount } = await pool.query(
    `UPDATE tests
     SET goal = (goal - 'min_sample_size' - 'min_conversions_per_variation' - $1::text)
     WHERE goal ? $1`,
    [SEED_FLOOR_MARKER]
  );
  return rowCount;
}

async function main() {
  const args = parseArgs(process.argv);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Check .env');
    process.exit(1);
  }
  const pool = new Pool({ connectionString, ssl: false, max: 4 });

  try {
    if (args.clear) {
      const removed = await clearSeed(pool);
      const floors = await clearStampedFloors(pool);
      console.log(
        `Removed ${removed.assignments.toLocaleString()} seeded assignments and ${removed.events.toLocaleString()} seeded events.`
      );
      console.log(`Removed seeded sample floors from ${floors} tests.`);
      return;
    }

    const tests = await loadRunningTests(pool, args);
    if (tests.length === 0) {
      console.log('No running tests matched.');
      return;
    }

    console.log(`Running tests matched: ${tests.length}`);

    const client = args.dryRun ? null : await pool.connect();
    const scenarioCounts = {};
    const seededIds = [];
    let totalAssignments = 0;
    let totalEvents = 0;
    let printed = 0;

    try {
      if (client) await client.query('BEGIN');

      // Each test is generated and written in turn; holding a million rows in
      // memory just to insert them at the end is not worth it.
      for (let index = 0; index < tests.length; index += 1) {
        const test = tests[index];
        const built = buildTestData(test, args, index);
        if (!built) continue;

        scenarioCounts[built.scenario] = (scenarioCounts[built.scenario] || 0) + 1;
        seededIds.push(test.id);
        totalAssignments += built.assignments.length;
        totalEvents += built.events.length;

        if (printed < 6) {
          printed += 1;
          console.log(
            `\n${built.scenario}${built.forceSrm ? ' + forced SRM' : ''} — ${String(test.name).slice(0, 62)}`
          );
          built.summary.forEach(arm => {
            console.log(
              `   ${arm.variantName.padEnd(24).slice(0, 24)} ${String(arm.visitors).padStart(6)} visitors  ${String(arm.conversions).padStart(4)} orders  ${arm.rate.toFixed(2).padStart(5)}% CR  $${arm.rpv.toFixed(2).padStart(6)} RPV`
            );
          });
        }

        if (client) {
          await insertRows(
            client,
            'test_assignments',
            ['test_id', 'user_id', 'shop_domain', 'variant_id', 'variant_name', 'assigned_at'],
            built.assignments
          );
          await insertRows(
            client,
            'events',
            [
              'test_id',
              'variant_id',
              'user_id',
              'shop_domain',
              'event_type',
              'event_name',
              'event_value',
              'metadata',
              'created_at',
            ],
            built.events
          );
          process.stdout.write(
            `\r  seeded ${index + 1}/${tests.length} tests · ${totalAssignments.toLocaleString()} visitors · ${totalEvents.toLocaleString()} orders`
          );
        }
      }

      console.log(`\n\nScenario mix: ${JSON.stringify(scenarioCounts)}`);
      console.log(
        `Rows: ${totalAssignments.toLocaleString()} assignments, ${totalEvents.toLocaleString()} conversion events`
      );

      if (!client) {
        console.log('\nDry run — nothing written.');
        return;
      }

      let floors = null;
      if (args.stampFloors) {
        floors = await stampFloors(client, seededIds, args.visitors);
      }
      await client.query('COMMIT');
      console.log('Written.');
      if (floors) {
        console.log(
          `Stamped floors on ${floors.rowCount} tests: ${floors.floor} visitors and ${floors.conversions} conversions per variation.`
        );
      }
      console.log('Undo with: node server/scripts/seed-demo-analytics.js --clear');
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (client) client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
