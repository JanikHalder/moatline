<script setup lang="ts">
import { useData } from "vitepress";

/** Date and a way back, under a post's title. */
const { frontmatter } = useData();
const raw = frontmatter.value.date;
const date = raw
  ? raw instanceof Date
    ? raw.toISOString().slice(0, 10)
    : String(raw).slice(0, 10)
  : "";
const shown = date
  ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
  : "";
</script>

<template>
  <p class="post-meta">
    <time v-if="date" :datetime="date">{{ shown }}</time>
    <span v-if="date"> · </span>
    <a href="/blog/">All posts</a>
  </p>
</template>

<style scoped>
.post-meta {
  margin-top: -8px;
  font-size: 14px;
  color: var(--vp-c-text-3);
}
</style>
