---
layout: page
sidebar: false
aside: false
title: Terms of service
---

<script setup>
import { legal } from "./.vitepress/legal";
</script>

<div class="legal vp-doc">

# Terms of service

Last updated {{ legal.updated }}.

These terms govern the use of the hosted Moatline service at moatline.dev (the "Service"), provided by {{ legal.company }}, {{ legal.address }} ("we", "us"). Running Moatline yourself from its source code is governed by its open-source licences (AGPL-3.0 for the server and app, MIT for the agent), not by these terms.

## 1. The Service

Moatline watches software you deploy: it reads your repositories' dependencies, opens pull requests with fixes and updates, deploys through the platforms you connect, checks your sites and receives reports from the agent you install on your servers. What it does depends on what you connect and switch on.

## 2. Your account

You need an account to use the Service. Keep your password and second factor safe; you are responsible for what happens under your account and in organizations you manage. An organization's owners and admins decide who belongs to it and what it may access.

## 3. What you connect

You may only connect repositories, servers, platforms and websites you are allowed to manage. You give us the right to process their data as far as needed to run the Service — for example to read a lockfile, open a pull request you asked for, or start a deploy. Access tokens are stored encrypted and used only for that.

The Service acts on your behalf when you tell it to: automatic fixes, merges, deploys and rollbacks happen only where you switched them on. You remain responsible for reviewing changes and for your own systems.

## 4. Acceptable use

Do not use the Service to scan, probe or attack systems you do not control, to break the law, to overload the Service, or to get around plan limits or access controls.

## 5. Plans, prices and payment

The cloud is offered in monthly plans (see [Pricing](/pricing)). Payments are processed by Stripe, which acts as the merchant of record for our sales (Stripe Managed Payments): Stripe handles payment, taxes and invoices, and supports you with questions about a payment. Plans renew every month until cancelled. You can switch plans at any time; Stripe charges or credits the difference for the rest of the period. Refunds follow our [refund policy](/refunds).

If an organization uses more than its plan includes, adding further servers or repositories requires a bigger plan; what exists keeps working.

## 6. Cancellation and termination

You can cancel at any time under Settings → Billing; the plan ends at the end of the period paid for. You can delete your account or organization at any time. We may suspend or end access if you seriously or repeatedly break these terms, after a warning where reasonable. After an organization is deleted, its data is removed as described in the [privacy policy](/privacy).

## 7. Availability and changes

We work to keep the Service available and secure but do not promise that it is free of interruptions or errors. We may change and develop the Service; we will tell you in advance about changes that take away features you rely on in a paid plan.

## 8. Liability

We are liable without limitation for damage caused intentionally or through gross negligence, and for injury to life, body or health. Otherwise, for slight negligence we are liable only for breach of essential obligations, limited to the damage typical and foreseeable at the time the contract was made, and in total to the fees paid in the twelve months before the damage. Mandatory consumer rights remain unaffected. The Service suggests and applies software changes; you remain responsible for backups of your own systems and data.

## 9. Changes to these terms

We may update these terms. We will announce material changes by email at least 30 days before they apply; if you do not agree, you can cancel before then.

## 10. Law and disputes

The law of {{ legal.jurisdiction }} applies, excluding its conflict-of-law rules and the UN Convention on Contracts for the International Sale of Goods. If you are a consumer, the mandatory protection of the country you live in stays in force.

Contact: {{ legal.email }}

</div>
