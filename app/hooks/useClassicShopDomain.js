import { useOutletContext, useParams } from 'react-router';
import { getShopDomain } from '../services';

/**
 * Resolve shop for Classic Smart Pricing screens.
 * Prefer React Router outlet context (from app.tsx loader) over window/query fallbacks.
 */
export default function useClassicShopDomain() {
  const ctx = useOutletContext() || {};
  const { domain } = useParams();
  return String(domain || ctx.shop || getShopDomain() || '')
    .trim()
    .toLowerCase();
}
