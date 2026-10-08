import fs from "node:fs";
import path from "node:path";
import { defineConfig, type HeadConfig } from "vitepress";
import { brand } from "./brand";

/**
 * Plausible, when the build is told where to report: PLAUSIBLE_DOMAIN (the
 * site as registered there) and, for self-hosted Plausible or a site's own
 * script (pa-….js), PLAUSIBLE_SCRIPT. Without them, no analytics at all.
 */
const plausibleDomain = process.env.PLAUSIBLE_DOMAIN?.trim();
const plausibleScript =
  process.env.PLAUSIBLE_SCRIPT?.trim() || "https://plausible.io/js/script.js";
// The newer per-site scripts carry the domain and need plausible.init().
const perSiteScript = /\/js\/pa-[^/]+\.js$/.test(plausibleScript);
const plausible: HeadConfig[] =
  plausibleDomain || perSiteScript
    ? [
        [
          "script",
          perSiteScript
            ? { async: "", src: plausibleScript }
            : {
                defer: "",
                "data-domain": plausibleDomain!,
                src: plausibleScript,
              },
        ],
        [
          "script",
          {},
          `window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};${perSiteScript ? "plausible.init();" : ""}`,
        ],
      ]
    : [];

export default defineConfig({
  title: brand.name,
  description: `${brand.tagline}. Vulnerabilities fixed by pull request, guarded deploys, MCP for coding agents, uptime and server checks for Dokploy, Coolify and any Docker host. Self-host free or Stripe checkout from 8 €/month.`,
  cleanUrls: true,
  sitemap: { hostname: brand.site },
  // Designed light-first; the dark variant follows the toggle.
  appearance: true,
  // The reference pages come from docs/ and link to files in the repository.
  ignoreDeadLinks: [/^\.\.?\//, /SECURITY/, /LICENSE/],
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#0b1220" }],
    ["meta", { property: "og:site_name", content: brand.name }],
    ["meta", { name: "twitter:card", content: "summary" }],
    ...plausible,
  ],
  // Per page: canonical URL, Open Graph, and for posts structured data —
  // what search engines and AI answers read to cite a page correctly.
  transformHead({ pageData }) {
    const fm = pageData.frontmatter;
    const route = pageData.relativePath
      .replace(/(^|\/)index\.md$/, "$1")
      .replace(/\.md$/, "");
    const url = `${brand.site}/${route}`;
    const title = fm.title ?? pageData.title ?? brand.name;
    const description = fm.description ?? pageData.description ?? "";
    const isPost = route.startsWith("blog/") && !!fm.date;
    const head: HeadConfig[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      [
        "meta",
        { property: "og:type", content: isPost ? "article" : "website" },
      ],
    ];
    if (description)
      head.push(
        ["meta", { property: "og:description", content: description }],
        ["meta", { name: "twitter:description", content: description }]
      );
    if (isPost) {
      const date =
        fm.date instanceof Date
          ? fm.date.toISOString().slice(0, 10)
          : String(fm.date).slice(0, 10);
      head.push(
        ["meta", { property: "article:published_time", content: date }],
        [
          "script",
          { type: "application/ld+json" },
          JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: title,
            description,
            datePublished: date,
            dateModified: date,
            url,
            mainEntityOfPage: url,
            author: {
              "@type": "Organization",
              name: brand.name,
              url: brand.site,
            },
            publisher: {
              "@type": "Organization",
              name: brand.name,
              logo: { "@type": "ImageObject", url: `${brand.site}/logo.svg` },
            },
            keywords: (fm.tags ?? []).join(", "),
          }),
        ],
        [
          "script",
          { type: "application/ld+json" },
          JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: brand.name,
                item: brand.site,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Blog",
                item: `${brand.site}/blog/`,
              },
              { "@type": "ListItem", position: 3, name: title, item: url },
            ],
          }),
        ]
      );
    }
    if (Array.isArray(fm.faq) && fm.faq.length)
      head.push([
        "script",
        { type: "application/ld+json" },
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: fm.faq.map((f: { q: string; a: string }) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      ]);
    if (route === "")
      head.push([
        "script",
        { type: "application/ld+json" },
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: brand.name,
          description: brand.tagline,
          url: brand.site,
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Linux, Docker",
          offers: [
            {
              "@type": "Offer",
              name: "Self-hosted",
              price: "0",
              priceCurrency: "EUR",
            },
            {
              "@type": "Offer",
              name: "Solo",
              price: "8",
              priceCurrency: "EUR",
            },
            {
              "@type": "Offer",
              name: "Team",
              price: "24",
              priceCurrency: "EUR",
            },
            {
              "@type": "Offer",
              name: "Agency",
              price: "49",
              priceCurrency: "EUR",
            },
          ],
        }),
      ]);
    return head;
  },
  // RSS for the blog, and llms.txt: a plain map of the site for AI answers.
  buildEnd({ outDir }) {
    const dir = path.resolve(__dirname, "../blog");
    const posts = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") && f !== "index.md")
      .map((f) => {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
        const field = (k: string) =>
          fm.match(new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m"))?.[1] ?? "";
        return {
          url: `${brand.site}/blog/${f.replace(/\.md$/, "")}`,
          title: field("title"),
          description: field("description"),
          date: field("date"),
        };
      })
      .filter((p) => p.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    fs.writeFileSync(
      path.join(outDir, "feed.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${brand.name} blog</title><link>${brand.site}/blog/</link>
<description>${esc(brand.tagline)}</description>
<atom:link href="${brand.site}/feed.xml" rel="self" type="application/rss+xml"/>
${posts
  .map(
    (p) =>
      `<item><title>${esc(p.title)}</title><link>${p.url}</link><guid>${p.url}</guid><pubDate>${new Date(`${p.date}T08:00:00Z`).toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`
  )
  .join("\n")}
</channel></rss>
`
    );
    fs.writeFileSync(
      path.join(outDir, "llms.txt"),
      `# ${brand.name}

> ${brand.tagline}. Moatline watches what you deploy on Dokploy, Coolify, Komodo, Portainer or any Docker host — code, containers, servers, databases and domains — and fixes what it can: pull requests for vulnerable dependencies, guarded deploys, MCP for AI assistants with scopes and audit trail. Open source (AGPL-3.0, agent MIT); self-hosted free or cloud from 8 €/month via Stripe — no sales process.

## Product
- [Introduction](${brand.site}/guide/introduction): what Moatline watches and how the layers connect
- [AI agents and MCP](${brand.site}/guide/ai-agents): API keys, scopes, automation policy
- [Quick start](${brand.site}/guide/quick-start): self-host with Docker Compose
- [Vulnerabilities and fixes](${brand.site}/guide/vulnerabilities): lockfile scans, fix pull requests, merge and deploy
- [Deploys, uptime, self-healing](${brand.site}/guide/operations): deploy guard, rollback, checks from several locations, status pages
- [Servers and platforms](${brand.site}/guide/servers): the push-only agent, backups, platform checks
- [Pricing](${brand.site}/pricing): Solo 8 €, Team 24 €, Agency 49 € per month; self-hosted free
- [Security model](${brand.site}/guide/security)
- [FAQ](${brand.site}/guide/faq)

## Blog
${posts.map((p) => `- [${p.title}](${p.url}): ${p.description}`).join("\n")}
`
    );
  },
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: brand.name,
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "Reference", link: "/reference/server-monitoring" },
      { text: "Blog", link: "/blog/" },
      { text: "Pricing", link: "/pricing" },
      ...(brand.cloudUrl
        ? [
            {
              text: "Sign in",
              link: `${brand.cloudUrl}/login`,
              target: "_self",
            },
          ]
        : []),
    ],
    sidebar: {
      "/": [
        {
          text: "Getting started",
          items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Quick start", link: "/guide/quick-start" },
            { text: "Connect Dokploy or Coolify", link: "/guide/platforms" },
            { text: "Install the agent", link: "/guide/agent" },
            { text: "AI agents and MCP", link: "/guide/ai-agents" },
          ],
        },
        {
          text: "Features",
          items: [
            {
              text: "Vulnerabilities and fixes",
              link: "/guide/vulnerabilities",
            },
            {
              text: "Deploys, uptime, self-healing",
              link: "/guide/operations",
            },
            { text: "Servers and platforms", link: "/guide/servers" },
            { text: "Versions and new sites", link: "/guide/overview" },
            { text: "Upgrading a server's OS", link: "/guide/os-upgrade" },
            {
              text: "Tailscale, SSH and Dokploy",
              link: "/guide/tailscale",
            },
          ],
        },
        {
          text: "Reference",
          items: [
            { text: "Server monitoring", link: "/reference/server-monitoring" },
            { text: "Health endpoint", link: "/reference/health-endpoint" },
            { text: "Update strategy", link: "/reference/update-strategy" },
            { text: "Images and templates", link: "/reference/templates" },
          ],
        },
        {
          text: "Project",
          items: [
            { text: "Security model", link: "/guide/security" },
            { text: "FAQ", link: "/guide/faq" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: brand.repo }],
    search: { provider: "local" },
    editLink: {
      pattern: `${brand.repo}/edit/main/site/:path`,
      text: "Edit this page",
    },
    footer: {
      message:
        'Server and app under AGPL-3.0, agent under MIT. · <a href="/pricing">Pricing</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refunds">Refunds</a> · <a href="/imprint">Imprint</a>',
      copyright: `© ${new Date().getFullYear()} the ${brand.name} contributors`,
    },
  },
});
