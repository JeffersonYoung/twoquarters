export type ImageWidth = 480 | 960 | 1600;

// Only canonical, same-origin upload URLs and these build-time assets have variants.
// Leave external URLs, data/blob URLs and other static files exactly as supplied.
const localImagePath = /^\/api\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const staticImagePaths = new Set([
  "/images/automotive/hero-mclaren.jpg",
  "/images/bts/francesco-ungaro-P45gR9kH0SM-unsplash.jpg",
]);

export function imageVariant(src: string, width: ImageWidth): string {
  if (localImagePath.test(src)) return `${src}?width=${width}`;
  if (staticImagePaths.has(src)) return `${src.slice(0, -4)}-${width}.webp`;
  return src;
}

export function responsiveImage(
  src: string,
  widths: readonly [ImageWidth, ...ImageWidth[]],
  sizes: string,
  originalWidth?: number,
): { src: string; srcSet?: string; sizes?: string } {
  const fallback = imageVariant(src, widths[0]);
  if (fallback === src) return { src };
  const knownWidth = originalWidth && Number.isFinite(originalWidth) && originalWidth > 0
    ? Math.floor(originalWidth)
    : undefined;
  const seen = new Set<number>();
  const candidates = widths.flatMap((width) => {
    const actualWidth = knownWidth ? Math.min(width, knownWidth) : width;
    if (seen.has(actualWidth)) return [];
    seen.add(actualWidth);
    return [`${imageVariant(src, width)} ${actualWidth}w`];
  });
  // Variants never upscale: known small uploads need only one request and the
  // width descriptors must reflect their real pixels, not the requested limit.
  if (candidates.length === 1) return { src: fallback };
  return {
    src: fallback,
    srcSet: candidates.join(", "),
    sizes,
  };
}

// React 18 passes unknown lowercase attributes through without a development
// warning; the camel-cased fetchPriority prop is supported starting in React 19.
export const highPriorityImage = { fetchpriority: "high" } as const;

// Keep these in sync with styles.css: 28px desktop gutters, 24px gaps in a
// 12-column grid; at <=640px every image fills the viewport minus 16px gutters.
function gridImageSizes(columns: number): string {
  if (columns === 12) return "(max-width: 640px) calc(100vw - 32px), calc(100vw - 56px)";
  const viewportWidth = Number((100 * columns / 12).toFixed(4));
  const gutterWidth = Number((24 + 8 * columns / 3).toFixed(4));
  return `(max-width: 640px) calc(100vw - 32px), calc(${viewportWidth}vw - ${gutterWidth}px)`;
}

export function projectCardSizes(index: number): string {
  return gridImageSizes([7, 4, 4, 6][index % 4]);
}

export function projectGallerySizes(index: number): string {
  return gridImageSizes([12, 8, 7, 8, 7][index % 5]);
}
