import styles from '../publicStyles';

export default function PublicDocPage({ eyebrow, title, updated, intro, sections }) {
  return (
    <article className={styles.docCard}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={`${styles.title} ripx-classic-sans`}>{title}</h1>
      <p className={styles.docUpdated}>Updated {updated}</p>
      {intro ? <p className={styles.docIntro}>{intro}</p> : null}
      {sections.map((section) => (
        <section key={section.title} className={styles.docSection}>
          <h2 className={styles.docHeading}>{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className={styles.docBody}>
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
