<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { brand, signupUrl } from "../brand";
import { data as posts } from "../../blog/posts.data";

type Kind = "finding" | "work" | "ok";

/** One real night: a Next.js advisory, fixed and shipped while you slept. */
const night: Array<{ at: string; what: string; text: string; kind: Kind }> = [
  {
    at: "02:14",
    what: "finding",
    kind: "finding",
    text: "next 15.1.2 in shop.example: CVE-2025-29927, critical",
  },
  {
    at: "02:14",
    what: "fix",
    kind: "work",
    text: "Branch fix/next-15.2.3. Lockfile only; next and @next/* moved together",
  },
  { at: "02:19", what: "check", kind: "ok", text: "Typecheck passed" },
  {
    at: "02:19",
    what: "pull request",
    kind: "work",
    text: "#212 opened in acme/shop",
  },
  {
    at: "07:42",
    what: "merge",
    kind: "work",
    text: "Merged by you, from your phone",
  },
  {
    at: "07:43",
    what: "deploy",
    kind: "work",
    text: "Dokploy started the build",
  },
  {
    at: "07:47",
    what: "live",
    kind: "ok",
    text: "New commit is serving, /admin answers, stable for two minutes",
  },
  { at: "07:47", what: "closed", kind: "ok", text: "Finding resolved" },
];

const watches = [
  {
    what: "Code",
    text: "Every npm dependency, read from the lockfile and checked against the advisory database and the list of malicious packages. Fixes arrive as pull requests that change as little as possible.",
  },
  {
    what: "Deploys",
    text: "Each deploy through Dokploy or Coolify is followed to the end: the build, the live URL, the admin. A deploy that breaks the site is rolled back.",
  },
  {
    what: "Servers",
    text: "Updates waiting to be installed, disks filling up, attacks CrowdSec blocked, vulnerabilities in the host and in every running image, processes that should not be there.",
  },
  {
    what: "Everything around",
    text: "Databases open to the internet, backups that stopped, images nobody maintains, certificates and domains about to expire, sites that went down — and why.",
  },
];

const never = [
  "The agent on your server opens no port and takes no commands. It only sends reports.",
  "Environment variables are read by name, never by value.",
  "From logs, only error lines leave the server — with passwords, tokens, e-mail and IP addresses removed.",
  "Nothing is merged, deployed or restarted unless you turned that on, per repository.",
];

const agents = [
  {
    what: "MCP for coding agents",
    text: "Claude, Cursor and other assistants read findings, uptime and servers over MCP — with scopes, optional allowlists and a full audit trail. Fix PRs only when you grant the fix scope.",
  },
  {
    what: "Findings as a task list",
    text: "Copy a markdown report into your agent, or fetch it over MCP: what to change, why, and how to tell it worked.",
  },
  {
    what: "Guarded automation",
    text: "Auto-fix opens lockfile-only pull requests. Org policy can require PR review, disable MCP fixes, and default new repos to auto-fix critical CVEs.",
  },
];

const root = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.value
      ?.querySelectorAll("[data-reveal]")
      .forEach((el) => el.classList.add("is-in"));
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          observer?.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );
  root.value
    ?.querySelectorAll("[data-reveal]")
    .forEach((el) => observer!.observe(el));
});

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div ref="root" class="home">
    <section class="hero">
      <div class="pitch">
        <p class="brand" data-reveal>{{ brand.name }}</p>
        <h1 data-reveal style="--d: 1">
          Keeps self&#8209;hosted apps patched, backed up and running.
        </h1>
        <p class="lead" data-reveal style="--d: 2">
          {{ brand.name }} watches the code, containers and servers behind your
          Dokploy and Coolify apps. When something is wrong, it opens the pull
          request, ships the fix through your platform and checks the site
          afterwards. No demos, no seat games — Stripe checkout or self-host
          free.
        </p>
        <div class="actions" data-reveal style="--d: 3">
          <a v-if="signupUrl" class="button" :href="signupUrl">Start now</a>
          <a
            class="text-link"
            :class="{ button: !signupUrl }"
            href="/guide/quick-start"
            >Self-host it</a
          >
          <a class="text-link" href="/guide/introduction">How it works</a>
        </div>
        <p class="aside" data-reveal style="--d: 4">
          Open source. Buy online. Dokploy, Coolify and any Docker host.
        </p>
      </div>

      <figure
        class="log"
        aria-label="An example night"
        data-reveal
        style="--d: 2"
      >
        <figcaption>shop.example, last night</figcaption>
        <ol>
          <li
            v-for="(l, i) in night"
            :key="i"
            :class="l.kind"
            :style="{ '--i': i }"
          >
            <time>{{ l.at }}</time>
            <span class="what">{{ l.what }}</span>
            <span class="text">{{ l.text }}</span>
          </li>
        </ol>
      </figure>
    </section>

    <section class="block" data-reveal>
      <h2>What it watches</h2>
      <dl class="watches">
        <template v-for="w in watches" :key="w.what">
          <dt>{{ w.what }}</dt>
          <dd>{{ w.text }}</dd>
        </template>
      </dl>
    </section>

    <section class="block" data-reveal>
      <h2>For agencies</h2>
      <p class="agency">
        What ManageWP is for WordPress, for sites built with Next.js, Payload
        and Node: every client's sites on Dokploy, Coolify, Komodo or Portainer
        in one place — security fixes by pull request, guarded deploys, uptime
        from several locations, a status page and a monthly report per client,
        and maintenance windows so planned work does not wake anyone up.
      </p>
    </section>

    <section class="block" data-reveal>
      <h2>For AI agents &amp; automated code</h2>
      <dl class="watches">
        <template v-for="a in agents" :key="a.what">
          <dt>{{ a.what }}</dt>
          <dd>{{ a.text }}</dd>
        </template>
      </dl>
    </section>

    <section class="block" data-reveal>
      <h2>What it never does</h2>
      <ul class="never">
        <li v-for="n in never" :key="n">{{ n }}</li>
      </ul>
      <p class="more">
        <a href="/guide/security">The security model</a>
      </p>
    </section>

    <section id="pricing" class="block" data-reveal>
      <h2>Pricing</h2>
      <div class="plans">
        <div>
          <h3>Self-hosted, free</h3>
          <p>
            Every feature, no limits. Docker Compose or one click from the
            Dokploy and Coolify catalogs, updates with one click. Server and app
            under AGPL-3.0, the agent under MIT.
          </p>
        </div>
        <div>
          <h3>Cloud, from 8 € a month</h3>
          <p>
            Hosted and updated for you in the EU — about what the server to host
            it yourself would cost, without maintaining it. No sales call: pick
            a plan, pay with Stripe, cancel anytime.
            <strong>Solo</strong> 8 € (3 servers, 10 repositories),
            <strong>Team</strong> 24 € (15 servers), <strong>Agency</strong> 49
            € (50 servers). Every plan has every feature; Stripe handles
            invoices and VAT.
            <template v-if="!brand.cloudUrl"> Opens soon.</template>
          </p>
          <a v-if="signupUrl" class="button" :href="signupUrl">Start now</a>
        </div>
      </div>
      <p class="more"><a href="/pricing">All plans and questions</a></p>
    </section>

    <section class="block" data-reveal>
      <h2>From the blog</h2>
      <ul class="never">
        <li v-for="p in posts.slice(0, 3)" :key="p.url">
          <a class="text-link" :href="p.url">{{ p.title }}</a>
        </li>
      </ul>
      <p class="more"><a href="/blog/">All posts</a></p>
    </section>

    <section class="block install" data-reveal>
      <h2>Try it on a server you have</h2>
      <pre><code>git clone {{ brand.repo }}.git
cd moatline/deploy && cp .env.example .env
docker compose up -d</code></pre>
      <p class="more">
        Then <a href="/guide/quick-start">connect GitHub and your platform</a>.
      </p>
    </section>
  </div>
</template>

<style scoped>
.home {
  max-width: 1120px;
  margin: 0 auto;
  padding: 72px 24px 120px;
  color: var(--pc-ink);
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 56px;
  align-items: start;
}
.brand {
  margin: 0 0 18px;
  font-size: clamp(28px, 3.8vw, 40px);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--pc-green);
}
h1 {
  font-size: clamp(28px, 3.8vw, 40px);
  line-height: 1.12;
  font-weight: 600;
  letter-spacing: -0.025em;
  margin: 0;
  max-width: 18ch;
  text-wrap: balance;
  hyphens: manual;
  color: var(--pc-ink);
}
.lead {
  margin: 22px 0 0;
  font-size: 18px;
  line-height: 1.6;
  color: var(--pc-ink-2);
  max-width: 46ch;
}
.actions {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 32px;
}
.button {
  display: inline-block;
  padding: 11px 22px;
  border-radius: 6px;
  background: var(--pc-green);
  color: var(--pc-paper);
  font-weight: 500;
  text-decoration: none;
  transition:
    background 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
}
.button:hover {
  background: var(--vp-c-brand-2);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(11, 107, 71, 0.18);
}
.button:active {
  transform: translateY(0);
}
.text-link,
.more a {
  color: var(--pc-ink);
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: var(--pc-line);
  text-underline-offset: 4px;
  transition: text-decoration-color 0.2s ease;
}
.text-link:hover,
.more a:hover {
  text-decoration-color: var(--pc-green);
}
.aside {
  margin-top: 20px;
  font-size: 14px;
  color: var(--pc-ink-3);
}

.log {
  margin: 6px 0 0;
  border-left: 3px solid var(--pc-green);
  padding: 4px 0 4px 24px;
}
figcaption {
  font-size: 14px;
  color: var(--pc-ink-3);
  margin-bottom: 14px;
}
.log ol {
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  line-height: 1.5;
}
.log li {
  display: grid;
  grid-template-columns: 3.6em 7.6em minmax(0, 1fr);
  gap: 12px;
  padding: 7px 0;
  border-top: 1px solid var(--pc-line);
}
.log li:first-child {
  border-top: 0;
}
time {
  color: var(--pc-ink-3);
}
.what {
  color: var(--pc-ink-2);
}
.finding .what,
.finding .text {
  color: var(--pc-red);
}
.ok .what {
  color: var(--pc-green);
}
.text {
  color: var(--pc-ink);
}
@media (prefers-reduced-motion: no-preference) {
  .log li {
    animation: appear 0.4s ease-out backwards;
    animation-delay: calc(0.45s + var(--i) * 0.14s);
  }
}
@keyframes appear {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

[data-reveal] {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: no-preference) {
  [data-reveal] {
    opacity: 0;
    transform: translateY(14px);
    transition:
      opacity 0.55s ease,
      transform 0.55s ease;
    transition-delay: calc(var(--d, 0) * 0.07s);
  }
  [data-reveal].is-in {
    opacity: 1;
    transform: none;
  }
}

.block {
  margin-top: 104px;
  padding-top: 28px;
  border-top: 1px solid var(--pc-line);
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 8fr);
  column-gap: 56px;
  row-gap: 0;
}
.block > h2 {
  grid-row: 1 / span 3;
}
h2 {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  border: 0;
  padding: 0;
}
.block > :not(h2) {
  grid-column: 2;
}
.watches {
  display: grid;
  grid-template-columns: 11em minmax(0, 1fr);
  gap: 18px 32px;
  margin: 0;
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
  color: var(--pc-ink-2);
  line-height: 1.6;
  max-width: 62ch;
}
.never {
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--pc-ink-2);
  line-height: 1.6;
}
.never li + li {
  margin-top: 10px;
}
.more {
  margin: 20px 0 0;
}
.agency {
  margin: 0;
  color: var(--pc-ink-2);
  line-height: 1.6;
  max-width: 62ch;
}
.plans {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
}
.plans h3 {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 8px;
}
.plans p {
  margin: 0 0 16px;
  color: var(--pc-ink-2);
  line-height: 1.6;
}
.install pre {
  margin: 0;
  padding: 18px 20px;
  border-radius: 6px;
  background: var(--vp-code-block-bg);
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.7;
  border: 1px solid var(--pc-line);
}

@media (max-width: 900px) {
  .hero,
  .block {
    grid-template-columns: 1fr;
    gap: 32px;
  }
  .block > :not(h2) {
    grid-column: 1;
  }
  .block {
    margin-top: 72px;
    row-gap: 20px;
  }
  .block > h2 {
    grid-row: auto;
  }
}
@media (max-width: 600px) {
  .home {
    padding-top: 40px;
  }
  .watches,
  .plans {
    grid-template-columns: 1fr;
  }
  .watches {
    gap: 4px;
  }
  dd {
    margin-bottom: 14px;
  }
  .log li {
    grid-template-columns: 3.4em minmax(0, 1fr);
  }
  .log .what {
    display: none;
  }
  .actions {
    flex-wrap: wrap;
    gap: 16px;
  }
}
</style>
