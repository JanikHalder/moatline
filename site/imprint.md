---
layout: page
sidebar: false
aside: false
title: Imprint
---

<script setup>
import { legal } from "./.vitepress/legal";
</script>

<div class="legal vp-doc">

# Imprint

Information according to § 5 ECG and § 25 MedienG (Austria).

<p>
<strong>{{ legal.company }}</strong><br />
<span>{{ legal.address }}</span>
</p>

<p>
Email: <a :href="`mailto:${legal.email}`">{{ legal.email }}</a><br />
Phone: {{ legal.phone }}
</p>

<p v-if="legal.register || legal.vatId || legal.authority">
<span v-if="legal.register">Company register: {{ legal.register }}<br /></span>
<span v-if="legal.vatId">VAT ID: {{ legal.vatId }}<br /></span>
<span v-if="legal.authority">Membership and authority: {{ legal.authority }}</span>
</p>

Moatline is open-source software; its source code is at [github.com/JanikHalder/moatline](https://github.com/JanikHalder/moatline).

</div>
