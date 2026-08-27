import { useCallback, useState } from 'react';
import { applySmartPricingWinner, previewSmartPricingWinner } from '../services/smartPricingApi';
import { appendActivityToPlans, createActivityEntry } from '../components/SmartPricing/classic/classicActivity';
import { isOfferExperimentType } from '../components/SmartPricing/classic/offerSelection';
import { readInboxPlans, updateInboxPlan } from '../components/SmartPricing/smartPricingConstants';
import { patchServerInboxPlan } from '../components/SmartPricing/smartPricingInboxPersistence';

export function useSmartPricingWinnerRollout(shopDomain) {
  const [applyingPlanId, setApplyingPlanId] = useState(null);
  const [previewLoadingPlanId, setPreviewLoadingPlanId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const loadPreview = useCallback(
    async plan => {
      const testId = plan?.test_id;
      if (!testId) {
        throw new Error('No linked test found for this plan.');
      }
      setPreviewLoadingPlanId(plan.id);
      setError('');
      try {
        const data = await previewSmartPricingWinner(shopDomain, testId);
        setPreview({ plan, data });
        return data;
      } catch (err) {
        setError(err.message || 'Could not preview winner rollout.');
        throw err;
      } finally {
        setPreviewLoadingPlanId(null);
      }
    },
    [shopDomain]
  );

  const clearPreview = useCallback(() => {
    setPreview(null);
    setError('');
  }, []);

  const applyWinner = useCallback(
    async (plan, { publishToShopify = true } = {}) => {
      const testId = plan?.test_id;
      if (!testId) {
        throw new Error('No linked test found for this plan.');
      }
      setApplyingPlanId(plan.id);
      setError('');
      try {
        const data = await applySmartPricingWinner(shopDomain, testId, { publishToShopify });
        const appliedAt = new Date().toISOString();
        const current =
          (readInboxPlans(shopDomain) || []).find(row => row.id === plan.id) || plan;
        const isOffer = isOfferExperimentType(
          current.experiment_type || current.metadata?.experiment_type
        );
        const [stamped] = appendActivityToPlans(
          [{ ...current, status: 'applied', winner_applied_at: appliedAt }],
          createActivityEntry({
            id: 'winner_applied',
            kind: 'complete',
            title: isOffer ? 'Test completed' : 'Winner rolled out',
            detail: isOffer
              ? 'Offer test finished — catalog prices were not changed'
              : 'Winning price applied to Shopify',
            at: appliedAt,
            actor: current.owner_name || current.created_by_name || 'You',
          })
        );
        updateInboxPlan(shopDomain, plan.id, {
          status: 'applied',
          winner_applied_at: appliedAt,
          metadata: stamped.metadata,
        });
        patchServerInboxPlan(shopDomain, plan.id, {
          status: 'applied',
          winner_applied_at: appliedAt,
          metadata: stamped.metadata,
        }).catch(() => {});
        setPreview(null);
        return data;
      } catch (err) {
        setError(err.message || 'Could not apply winner.');
        throw err;
      } finally {
        setApplyingPlanId(null);
      }
    },
    [shopDomain]
  );

  return {
    applying: Boolean(applyingPlanId),
    applyingPlanId,
    previewLoadingPlanId,
    preview,
    error,
    loadPreview,
    clearPreview,
    applyWinner,
  };
}
