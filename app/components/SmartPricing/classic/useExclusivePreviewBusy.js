import { useCallback, useRef, useState } from 'react';
import {
  canAcquirePreviewBusy,
  shouldReleasePreviewBusy,
} from './classicExperimentDetailsHelpers';

/**
 * One in-flight preview at a time. Ref lock beats React setState so a second
 * click in the same tick cannot start another preview or clear the first.
 */
export default function useExclusivePreviewBusy() {
  const [previewBusyKey, setPreviewBusyKey] = useState('');
  const busyRef = useRef('');

  const beginPreview = useCallback(key => {
    const next = String(key || '').trim();
    if (!canAcquirePreviewBusy(busyRef.current, next)) return false;
    busyRef.current = next;
    setPreviewBusyKey(next);
    return true;
  }, []);

  const endPreview = useCallback(key => {
    if (!shouldReleasePreviewBusy(busyRef.current, key)) return;
    busyRef.current = '';
    setPreviewBusyKey('');
  }, []);

  return { previewBusyKey, beginPreview, endPreview };
}
