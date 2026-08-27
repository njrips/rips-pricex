/**
 * Unknown public paths stay in Pricify chrome via the layout ErrorBoundary.
 */
export const loader = async () => {
  throw new Response("Not found", { status: 404, statusText: "Not Found" });
};

export default function PublicSplat() {
  return null;
}
