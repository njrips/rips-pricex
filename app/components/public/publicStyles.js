/**
 * Identity class map — public CSS is a plain file (`app/styles/public-classic.css`),
 * not a CSS module. Keep `styles.hero` call sites without hashed names that vanish
 * when React hydrates <head>.
 */
const styles = new Proxy(
  {},
  {
    get(_target, prop) {
      return typeof prop === 'string' ? prop : '';
    },
  }
);

export default styles;
