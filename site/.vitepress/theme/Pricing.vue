<script setup lang="ts">
import { signupUrl } from "../brand";

/**
 * Keep in step with PLANS in apps/api/src/services/billing.ts — that is
 * what the app enforces; Stripe's prices are what is charged.
 */
const plans = [
  {
    name: "Solo",
    eur: 8,
    for: "Freelancers and side projects",
    limits: ["3 servers", "10 repositories"],
  },
  {
    name: "Team",
    eur: 24,
    for: "Teams and small companies",
    limits: ["15 servers", "Unlimited repositories"],
    featured: true,
  },
  {
    name: "Agency",
    eur: 49,
    for: "Agencies running sites for clients",
    limits: ["50 servers", "Unlimited repositories"],
  },
];

const included = [
  "Vulnerability and malicious-package scans from the lockfile",
  "Fix and update pull requests, waiting for your CI",
  "Merge & deploy through Dokploy, Coolify, Komodo or Portainer",
  "Deploy guard with rollback, uptime checks, self-healing",
  "Server agent: updates, disks, backups, CrowdSec, Trivy",
  "MCP for AI assistants, scopes, allowlists and audit trail",
  "GitHub, GitLab, Bitbucket, Gitea and Forgejo",
  "Clients, domains and the monthly report",
  "Team members, roles, two-factor authentication, audit log",
];

const compare = [
  ["A server for it", "≈ 5 € a month", "Included"],
  ["Postgres backups", "Yours to set up", "Done for you"],
  ["Updates of Moatline", "One click, when you get to it", "Automatic"],
  ["When the server is down", "So is the watching", "Still watching"],
  [
    "Outages",
    "Seen from where Moatline runs",
    "Confirmed from several locations",
  ],
  [
    "Status page for your customers",
    "Down with your server",
    "Stays up when you are down",
  ],
  ["Every feature", "Yes", "Yes"],
];

const faq = [
  {
    q: "What counts as a server?",
    a: "A machine with the Moatline agent on it. Repositories, sites, containers and checks on it are not counted.",
  },
  {
    q: "What happens at the limit?",
    a: "Nothing stops working. Adding one more server (or, on Solo, repository) asks you to move to the next plan — one click under Settings → Billing.",
  },
  {
    q: "Can I switch or cancel?",
    a: "Any time, from Settings → Billing — no ticket, no sales call. Switching is charged or credited for the rest of the month; cancelling ends the plan at the end of the period you paid for.",
  },
  {
    q: "Do I need a demo or a quote?",
    a: "No. Plans and prices are on this page. Sign up, pay with Stripe, start watching. Self-hosted is free forever.",
  },
  {
    q: "Invoices and VAT?",
    a: "Stripe is the merchant of record: it charges, adds the VAT that applies in your country and sends the invoices.",
  },
  {
    q: "Does Moatline run my code?",
    a: "Not in the cloud. Scans read the lockfile, fixes are checked by your repository's own CI. Self-hosted, you can let it typecheck and build.",
  },
  {
    q: "Why is self-hosting free?",
    a: "Moatline is open source: the server under AGPL-3.0, the agent under MIT. The cloud is for not having to run it.",
  },
];
</script>

<template>
  <div class="pricing">
    <header class="head">
      <h1>One price for everything you run.</h1>
      <p class="lead">
        A flat price per month for your whole organization — about what the
        server to host it yourself would cost, without maintaining it. Every
        plan has every feature. No demos, no seat SKUs, no sales process —
        Stripe checkout and you are in.
      </p>
    </header>

    <section class="plans" aria-label="Plans">
      <article
        v-for="p in plans"
        :key="p.name"
        class="plan"
        :class="{ featured: p.featured }"
      >
        <p v-if="p.featured" class="tag">Most teams</p>
        <h2>{{ p.name }}</h2>
        <p class="for">{{ p.for }}</p>
        <p class="price">
          <span class="amount">{{ p.eur }} €</span>
          <span class="per">/ month</span>
        </p>
        <ul class="limits">
          <li v-for="l in p.limits" :key="l">{{ l }}</li>
          <li>Every feature</li>
        </ul>
        <a v-if="signupUrl" class="button" :href="signupUrl"
          >Start with {{ p.name }}</a
        >
        <p v-else class="soon">Opens soon</p>
      </article>
      <article class="plan free">
        <h2>Self-hosted</h2>
        <p class="for">On a server you already have</p>
        <p class="price">
          <span class="amount">0 €</span>
          <span class="per">forever</span>
        </p>
        <ul class="limits">
          <li>No limits</li>
          <li>Every feature</li>
          <li>Docker Compose or one click in Dokploy and Coolify</li>
        </ul>
        <a class="button ghost" href="/guide/quick-start">Install it</a>
      </article>
    </section>

    <section class="block">
      <h2>In every plan</h2>
      <ul class="included">
        <li v-for="i in included" :key="i">{{ i }}</li>
      </ul>
    </section>

    <section class="block">
      <h2>Cloud or self-hosted?</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Self-hosted</th>
              <th>Cloud</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in compare" :key="r[0]">
              <th scope="row">{{ r[0] }}</th>
              <td>{{ r[1] }}</td>
              <td>{{ r[2] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="block">
      <h2>Questions</h2>
      <dl class="faq">
        <template v-for="f in faq" :key="f.q">
          <dt>{{ f.q }}</dt>
          <dd>{{ f.a }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.pricing {
  max-width: 1120px;
  margin: 0 auto;
  padding: 72px 24px 120px;
  color: var(--pc-ink);
}
.head {
  max-width: 720px;
}
h1 {
  font-size: clamp(32px, 4.2vw, 48px);
  line-height: 1.08;
  font-weight: 600;
  letter-spacing: -0.025em;
  margin: 0;
  text-wrap: balance;
}
.lead {
  margin: 20px 0 0;
  font-size: 18px;
  line-height: 1.6;
  color: var(--pc-ink-2);
  max-width: 56ch;
}

.plans {
  margin-top: 56px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.plan {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--pc-line);
  border-radius: 10px;
  background: var(--pc-paper);
}
.plan.featured {
  border-color: var(--pc-green);
  box-shadow: 0 0 0 1px var(--pc-green);
}
.plan.free {
  background: var(--pc-paper-2);
}
.tag {
  position: absolute;
  top: -11px;
  left: 20px;
  margin: 0;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--pc-green);
  color: var(--pc-paper);
  font-size: 12px;
  font-weight: 500;
}
.plan h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  border: 0;
  padding: 0;
}
.for {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--pc-ink-3);
}
.price {
  margin: 20px 0 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.amount {
  font-size: 36px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.per {
  color: var(--pc-ink-3);
  font-size: 14px;
}
.limits {
  margin: 20px 0 24px;
  padding: 0;
  list-style: none;
  font-size: 14px;
  line-height: 1.5;
  color: var(--pc-ink-2);
}
.limits li {
  padding-left: 20px;
  position: relative;
}
.limits li + li {
  margin-top: 8px;
}
.limits li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: var(--pc-green);
  font-weight: 600;
}
.button {
  margin-top: auto;
  display: block;
  text-align: center;
  padding: 10px 16px;
  border-radius: 6px;
  background: var(--pc-green);
  color: var(--pc-paper);
  font-weight: 500;
  text-decoration: none;
}
.button:hover {
  background: var(--vp-c-brand-2);
}
.button.ghost {
  background: transparent;
  color: var(--pc-ink);
  border: 1px solid var(--pc-line);
}
.button.ghost:hover {
  border-color: var(--pc-green);
}
.soon {
  margin: auto 0 0;
  padding: 10px 0;
  text-align: center;
  font-size: 14px;
  color: var(--pc-ink-3);
  border: 1px dashed var(--pc-line);
  border-radius: 6px;
}

.block {
  margin-top: 96px;
  padding-top: 28px;
  border-top: 1px solid var(--pc-line);
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 8fr);
  column-gap: 56px;
}
.block > h2 {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  border: 0;
  padding: 0;
}
.included {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 32px;
  color: var(--pc-ink-2);
  line-height: 1.5;
}
.included li {
  padding-left: 20px;
  position: relative;
}
.included li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: var(--pc-green);
  font-weight: 600;
}
.table-wrap {
  overflow-x: auto;
}
table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 15px;
}
th,
td {
  text-align: left;
  padding: 12px 16px 12px 0;
  border: 0;
  border-bottom: 1px solid var(--pc-line);
  background: transparent;
}
thead th {
  color: var(--pc-ink-3);
  font-weight: 500;
  font-size: 13px;
}
tbody th {
  font-weight: 500;
}
td {
  color: var(--pc-ink-2);
}
tr {
  background: transparent !important;
  border: 0;
}
.faq {
  margin: 0;
  display: grid;
  grid-template-columns: 14em minmax(0, 1fr);
  gap: 20px 32px;
}
.faq dt {
  font-weight: 600;
}
.faq dd {
  margin: 0;
  color: var(--pc-ink-2);
  line-height: 1.6;
  max-width: 62ch;
}

@media (max-width: 1000px) {
  .plans {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 900px) {
  .block {
    grid-template-columns: 1fr;
    row-gap: 20px;
    margin-top: 72px;
  }
}
@media (max-width: 600px) {
  .pricing {
    padding-top: 40px;
  }
  .plans,
  .included,
  .faq {
    grid-template-columns: 1fr;
  }
  .faq {
    gap: 4px;
  }
  .faq dd {
    margin-bottom: 14px;
  }
}
</style>
