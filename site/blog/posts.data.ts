import { createContentLoader } from "vitepress";

export type Post = {
  title: string;
  description: string;
  date: string;
  url: string;
  tags: string[];
};

declare const data: Post[];
export { data };

/** YAML reads 2026-10-06 as a Date; keep the day either way. */
export const isoDate = (d: unknown) =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

/** Every post under /blog, newest first. */
export default createContentLoader("blog/*.md", {
  transform(raw): Post[] {
    return raw
      .filter((p) => p.frontmatter.date)
      .map((p) => ({
        title: p.frontmatter.title,
        description: p.frontmatter.description,
        date: isoDate(p.frontmatter.date),
        url: p.url,
        tags: p.frontmatter.tags ?? [],
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  },
});
