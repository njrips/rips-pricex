/**
 * @typedef {'draft'|'queued'|'approved'|'running'|'complete'|'rejected'|'stale'} SmartPricingPlanStatus
 * @typedef {'profit_per_visitor'|'revenue_per_visitor'} SmartPricingObjective
 * @typedef {'equal'|'control_heavy'|'custom'} TrafficSplitStrategy
 * @typedef {'conservative'|'recommended'|'aggressive'} ScenarioPresetId
 * @typedef {'underpowered'|'adequate'|'strong'} PowerRating
 * @typedef {'control'|'challenger'} PriceArmRole
 *
 * @typedef {Object} PriceArm
 * @property {string} id
 * @property {string} label
 * @property {PriceArmRole} role
 * @property {number} price
 * @property {number} delta_percent
 * @property {number} allocation_percent
 * @property {number} [estimated_margin_percent]
 * @property {boolean} within_guardrail_band
 *
 * @typedef {Object} VariantCountOption
 * @property {number} count
 * @property {number} visitors_per_variant
 * @property {number} total_visitors
 * @property {number} estimated_days
 * @property {number} mde_percent
 * @property {PowerRating} power_rating
 * @property {boolean} recommended
 * @property {string} [feasibility_warning]
 *
 * @typedef {Object} StatisticalDesign
 * @property {SmartPricingObjective} primary_metric
 * @property {number} baseline_conversion_rate
 * @property {number} baseline_ppv
 * @property {number} confidence_level
 * @property {number} statistical_power
 * @property {number} mde_percent
 * @property {number} visitors_per_variant_required
 * @property {number} total_visitors_required
 * @property {number} estimated_duration_days
 * @property {number} daily_visitors_to_sku
 * @property {PowerRating} power_rating
 * @property {'practical'|'not_feasible'|'insufficient_data'} duration_feasibility
 * @property {number} practical_window_min_days
 * @property {number} practical_window_max_days
 * @property {string[]} feasibility_notes
 *
 * @typedef {Object} LearningPathRound
 * @property {number} round
 * @property {'planned'|'active'|'complete'|'skipped'} status
 * @property {{ floor: number, ceiling: number }} price_band
 * @property {number[]} candidate_arms_preview
 * @property {string} trigger
 *
 * @typedef {Object} ArmProjection
 * @property {string} arm_id
 * @property {number} price
 * @property {number} projected_ppv
 * @property {number} projected_monthly_profit_delta
 * @property {number} projected_conversion_delta_percent
 * @property {boolean} revenue_trap_risk
 *
 * @typedef {Object} GuardrailCheck
 * @property {string} id
 * @property {string} label
 * @property {string} threshold
 * @property {string} actual
 * @property {boolean} passed
 *
 * @typedef {Object} SmartPricingTestPlan
 * @property {string} id
 * @property {string} shop_domain
 * @property {SmartPricingPlanStatus} status
 * @property {string} schema_version
 * @property {string} product_id
 * @property {string} variant_id
 * @property {string} title
 * @property {number} current_price
 * @property {string} currency
 * @property {SmartPricingObjective} objective
 * @property {ScenarioPresetId} scenario_preset
 * @property {number} recommended_variant_count
 * @property {string} variant_count_rationale
 * @property {PriceArm[]} price_arms
 * @property {TrafficSplitStrategy} traffic_split_strategy
 * @property {StatisticalDesign} statistical_design
 * @property {VariantCountOption[]} variant_count_options
 * @property {LearningPathRound[]} learning_path
 * @property {ArmProjection[]} arm_projections
 * @property {GuardrailCheck[]} guardrail_checks
 * @property {Object} ai_summary
 * @property {number} plan_version
 * @property {string} [test_id]
 */

module.exports = {};
