const DiscountClass = {
  Product: 'PRODUCT',
  Order: 'ORDER',
  Shipping: 'SHIPPING',
};
const ProductDiscountSelectionStrategy = {
  First: 'FIRST',
  Maximum: 'MAXIMUM',
  All: 'ALL',
};
const OrderDiscountSelectionStrategy = {
  First: 'FIRST',
  Maximum: 'MAXIMUM',
};

function normalizePriceMethod(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isDirectPriceOverrideLine(line) {
  const method = normalizePriceMethod(line?.ripxPriceMethod?.value);
  return (
    method === 'direct_price_override' ||
    method === 'direct_override' ||
    method === 'native_variant_price'
  );
}

function normalizeOfferType(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'percent' || raw === 'percentage' || raw === 'pct') return 'percent';
  if (raw === 'fixed' || raw === 'fixed_amount' || raw === 'amount' || raw === 'money') {
    return 'fixed';
  }
  return '';
}

function lineMessage(line) {
  const message = String(line?.ripxOfferMessage?.value || '').trim();
  if (message) return message.slice(0, 120);
  const code = String(line?.ripxOfferCodeName?.value || '').trim();
  if (code) return code.slice(0, 48);
  return 'Offer test';
}

function buildCandidates(cartLines) {
  const candidates = [];
  for (const line of cartLines || []) {
    if (!line?.ripxTest?.value) continue;
    if (isDirectPriceOverrideLine(line)) continue;
    const offerType = normalizeOfferType(line?.ripxOfferDiscountType?.value);
    if (offerType !== 'percent' && offerType !== 'fixed') continue;
    const offerValue = Math.abs(Number.parseFloat(String(line?.ripxOfferDiscountValue?.value || '')));
    const qty = Math.max(1, Number(line?.quantity) || 1);
    const subtotal = Number.parseFloat(String(line?.cost?.subtotalAmount?.amount || ''));
    if (!(offerValue > 0) || !(subtotal > 0)) continue;
    const roundedSubtotal = Math.round(subtotal * 100) / 100;
    let discount = 0;
    if (offerType === 'percent') {
      const pct = Math.max(0, Math.min(100, offerValue));
      discount = Math.round(roundedSubtotal * (pct / 100) * 100) / 100;
    } else {
      discount = Math.round(Math.min(roundedSubtotal, offerValue * qty) * 100) / 100;
    }
    if (!(discount > 0)) continue;
    candidates.push({
      message: lineMessage(line),
      targets: [{ cartLine: { id: line.id } }],
      value: {
        fixedAmount: {
          amount: discount.toFixed(2),
          appliesToEachItem: false,
        },
      },
    });
  }
  return candidates;
}

export function cartLinesDiscountsGenerateRun(input) {
  const discountClasses = input.discount?.discountClasses || [];
  const hasProduct =
    !discountClasses.length || discountClasses.includes(DiscountClass.Product);
  const hasOrder = discountClasses.includes(DiscountClass.Order);
  const candidates = buildCandidates(input.cart?.lines || []);
  if (!candidates.length) {
    return { operations: [] };
  }
  if (!hasProduct && hasOrder) {
    const total = candidates.reduce((sum, c) => {
      const amt = Number.parseFloat(String(c?.value?.fixedAmount?.amount || ''));
      return Number.isFinite(amt) && amt > 0 ? sum + amt : sum;
    }, 0);
    if (!(total > 0)) return { operations: [] };
    return {
      operations: [
        {
          orderDiscountsAdd: {
            candidates: [
              {
                message: candidates[0]?.message || 'Offer test',
                targets: [{ orderSubtotal: { excludedCartLineIds: [] } }],
                value: { fixedAmount: { amount: total.toFixed(2) } },
              },
            ],
            selectionStrategy: OrderDiscountSelectionStrategy.Maximum,
          },
        },
      ],
    };
  }
  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}
