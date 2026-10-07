import { createContext, useContext, useEffect, useState } from "react";

/**
 * Width (px) below which the page content counts as narrow: 42rem, the same
 * size as the `@2xl/main` container query the tables use to stack their
 * secondary columns. It follows the space next to the sidebar, not the
 * viewport — a tablet with the sidebar open is as tight as a large phone.
 */
export const NARROW_CONTENT_PX = 672;

const NarrowContentContext = createContext(false);

export const NarrowContentProvider = NarrowContentContext.Provider;

/**
 * True when the main content area is narrow. Outside the app shell (unit
 * tests, auth pages) there is no provider and the wide layout is used.
 */
export function useNarrowContent(): boolean {
  return useContext(NarrowContentContext);
}

/** Tracks whether `el` is narrower than {@link NARROW_CONTENT_PX}. */
export function useIsNarrow(el: HTMLElement | null): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setNarrow(el.clientWidth < NARROW_CONTENT_PX);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return narrow;
}
