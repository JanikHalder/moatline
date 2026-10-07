/**
 * The product's name and links — change them here when it gets its final
 * name. The guide pages (Markdown) cannot import it: their GitHub links
 * need the same edit.
 */
export const brand = {
  name: "Moatline",
  tagline: "Security and operations for self-hosted apps",
  /** The landing page and docs. */
  site: "https://moatline.dev",
  repo: "https://github.com/JanikHalder/moatline",
  /** The hosted service; empty while there is none. */
  cloudUrl: "https://app.moatline.dev",
};

/** Straight to the sign-up form of the hosted service. */
export const signupUrl = brand.cloudUrl
  ? `${brand.cloudUrl}/login?mode=signup`
  : "";
