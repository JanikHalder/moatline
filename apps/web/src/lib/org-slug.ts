/**
 * Derive a URL-safe organization slug from a display name.
 *
 * Better Auth requires a unique slug when creating an organization, so a
 * short random suffix keeps two orgs with the same name from colliding.
 */
export function slugifyOrgName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : `org-${suffix}`;
}
