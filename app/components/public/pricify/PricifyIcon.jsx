/**
 * @param {{ name: string, size?: number, width?: number, height?: number, alt?: string }} props
 */
export default function PricifyIcon({ name, size = 20, width, height, alt = '' }) {
  const w = width ?? size;
  const h = height ?? size;
  return (
    <span className="px-icon" style={{ width: w, height: h }} aria-hidden={alt ? undefined : true}>
      <img src={`/pricify/${name}.svg`} alt={alt} width={w} height={h} />
    </span>
  );
}
