-- Remember what a merchant deleted, so nothing can put it back.
--
-- Deleting a test removed its inbox plans and archived its tests, and kept no
-- trace of either. Anything still holding a copy -- a second tab, another
-- device's local inbox, a wizard autosave already in flight -- saved the plans
-- straight back, and the server could not tell a deleted experiment from a new
-- one. Rows here are keyed by the experiment id and the test id, both of which
-- are generated once and never reused; plan ids are not recorded because the
-- older plan builder could repeat one within seconds.

CREATE TABLE IF NOT EXISTS smart_pricing_deletions (
  shop_domain VARCHAR(255) NOT NULL,
  entity_type VARCHAR(16) NOT NULL CHECK (entity_type IN ('experiment', 'test')),
  entity_id VARCHAR(255) NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_deletions_recent
  ON smart_pricing_deletions (shop_domain, entity_type, deleted_at DESC);

-- Tests launched before tests carried their plan and experiment ids could not
-- be reached by deleting their experiment, so they kept running behind a
-- deleted row and the orphan restore brought the row back. Give them the ids
-- their plans hold, and failing that, one derived from the experiment title the
-- list already groups them by.

UPDATE tests t
SET metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object('smart_pricing_plan_id', p.plan_id)
FROM smart_pricing_inbox_plans p
WHERE p.test_id = t.id
  AND p.shop_domain = LOWER(TRIM(t.shop_domain))
  AND COALESCE(t.metadata->>'smart_pricing_plan_id', '') = '';

UPDATE tests t
SET metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object('experiment_id', src.experiment_id)
FROM (
  SELECT p.shop_domain,
         p.test_id,
         COALESCE(
           NULLIF(p.plan_json->'metadata'->>'experiment_id', ''),
           NULLIF(p.plan_json->>'experiment_id', ''),
           NULLIF(p.plan_json->>'batch_id', '')
         ) AS experiment_id
    FROM smart_pricing_inbox_plans p
   WHERE p.test_id IS NOT NULL
) src
WHERE src.test_id = t.id
  AND src.shop_domain = LOWER(TRIM(t.shop_domain))
  AND src.experiment_id IS NOT NULL
  AND COALESCE(t.metadata->>'experiment_id', '') = '';

WITH legacy AS (
  SELECT t.id,
         regexp_replace(t.name, '^Smart Pricing · ', '') AS stripped,
         NULLIF(TRIM(t.metadata->>'experiment_title'), '') AS stored_title,
         LOWER(TRIM(t.shop_domain)) AS shop
    FROM tests t
   WHERE COALESCE(t.metadata->>'experiment_id', '') = ''
     AND t.status <> 'archived'
     AND (t.source = 'smart_pricing' OR t.metadata->>'smart_pricing_source' = 'smart_pricing')
),
named AS (
  SELECT id,
         shop,
         COALESCE(
           stored_title,
           CASE WHEN position(' · ' IN stripped) > 0 THEN TRIM(split_part(stripped, ' · ', 1)) END
         ) AS experiment_title
    FROM legacy
)
UPDATE tests t
SET metadata = COALESCE(t.metadata, '{}'::jsonb)
  || jsonb_build_object(
       'experiment_id',
       'legacy_' || substr(
         md5(
           CASE
             WHEN n.experiment_title IS NOT NULL AND n.experiment_title <> ''
               THEN n.shop || '|' || LOWER(n.experiment_title)
             ELSE t.id::text
           END
         ),
         1,
         20
       )
     )
  || CASE
       WHEN COALESCE(t.metadata->>'experiment_title', '') = ''
            AND COALESCE(n.experiment_title, '') <> ''
         THEN jsonb_build_object('experiment_title', n.experiment_title)
       ELSE '{}'::jsonb
     END
FROM named n
WHERE n.id = t.id;

-- The plans of those tests have to name the same experiment, or the list keeps
-- grouping them by title while a delete asks the server for the new id.
UPDATE smart_pricing_inbox_plans p
SET plan_json = jsonb_set(
      p.plan_json,
      '{metadata}',
      (CASE
         WHEN jsonb_typeof(p.plan_json->'metadata') = 'object' THEN p.plan_json->'metadata'
         ELSE '{}'::jsonb
       END)
      || jsonb_build_object('experiment_id', t.metadata->>'experiment_id')
      || CASE
           WHEN COALESCE(p.plan_json->'metadata'->>'experiment_title', '') = ''
                AND COALESCE(t.metadata->>'experiment_title', '') <> ''
             THEN jsonb_build_object('experiment_title', t.metadata->>'experiment_title')
           ELSE '{}'::jsonb
         END,
      true
    ),
    updated_at = NOW()
FROM tests t
WHERE p.test_id = t.id
  AND p.shop_domain = LOWER(TRIM(t.shop_domain))
  AND COALESCE(p.plan_json->'metadata'->>'experiment_id', '') = ''
  AND COALESCE(p.plan_json->>'experiment_id', '') = ''
  AND COALESCE(p.plan_json->>'batch_id', '') = ''
  AND COALESCE(t.metadata->>'experiment_id', '') <> '';
