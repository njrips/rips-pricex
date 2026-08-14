import { useId, useState } from 'react';
import styles from '../publicStyles';
import { FAQ_ITEMS } from './faqContent';

export default function FaqPage() {
  const baseId = useId();
  const [openId, setOpenId] = useState(FAQ_ITEMS[0]?.id || '');

  return (
    <section className={styles.docCard}>
      <p className={styles.eyebrow}>Help</p>
      <h1 className={`${styles.title} ripx-classic-sans`}>Frequently asked questions</h1>
      <p className={styles.subtitle}>
        Install, Setup, mapping, and billing — the same language as inside Admin.
      </p>
      <div className={styles.faqList}>
        {FAQ_ITEMS.map((item) => {
          const open = item.id === openId;
          const panelId = `${baseId}-${item.id}`;
          return (
            <div key={item.id} className={styles.faqItem}>
              <button
                type="button"
                className={styles.faqButton}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? '' : item.id)}
              >
                <span>{item.question}</span>
                <span className={styles.faqMark} aria-hidden>
                  {open ? '–' : '+'}
                </span>
              </button>
              <p id={panelId} className={styles.faqAnswer} hidden={!open}>
                {item.answer}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
