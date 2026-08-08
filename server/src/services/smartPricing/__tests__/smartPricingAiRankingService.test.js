const { mergeAiRanking, buildCompactCandidatePayload } = require('../smartPricingAiRankingService');

describe('smartPricingAiRankingService', () => {
  const baseRows = [
    {
      variant_id: 'gid://shopify/ProductVariant/1',
      title: 'Hoodie',
      opportunity_score: 0.72,
      recommended: false,
      eligible: true,
    },
    {
      variant_id: 'gid://shopify/ProductVariant/2',
      title: 'Tee',
      opportunity_score: 0.65,
      recommended: true,
      eligible: true,
    },
  ];

  it('builds compact candidate payload capped at 20 rows', () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      variant_id: `gid://shopify/ProductVariant/${index}`,
      title: `SKU ${index}`,
      opportunity_score: 0.5,
    }));
    expect(buildCompactCandidatePayload(rows)).toHaveLength(20);
  });

  it('merges AI reasons and reorders by priority rank', () => {
    const merged = mergeAiRanking(baseRows, {
      summary: 'Focus on hoodie margin upside.',
      items: [
        {
          variant_id: 'gid://shopify/ProductVariant/1',
          recommended: true,
          ai_reason: 'Strong margin with steady traffic.',
          priority_rank: 1,
        },
      ],
    });

    expect(merged[0].variant_id).toBe('gid://shopify/ProductVariant/1');
    expect(merged[0].ai_reason).toContain('Strong margin');
    expect(merged[0].recommended).toBe(true);
    expect(merged[0].ai_enriched).toBe(true);
  });

  it('returns original rows when AI payload is missing', () => {
    expect(mergeAiRanking(baseRows, null)).toEqual(baseRows);
  });
});
