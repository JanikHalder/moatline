<script setup lang="ts">
import { data as posts } from "../../blog/posts.data";

const fmt = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
</script>

<template>
  <div class="blog">
    <header>
      <h1>Blog</h1>
      <p class="lead">
        Running Next.js, Payload and Node apps on your own servers — what
        breaks, what leaks, and how to see it coming.
      </p>
      <p class="feed"><a href="/feed.xml">RSS feed</a></p>
    </header>
    <ol class="posts">
      <li v-for="p in posts" :key="p.url">
        <a :href="p.url">
          <time :datetime="p.date">{{ fmt(p.date) }}</time>
          <h2>{{ p.title }}</h2>
          <p>{{ p.description }}</p>
        </a>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.blog {
  max-width: 760px;
  margin: 0 auto;
  padding: 72px 24px 120px;
  color: var(--pc-ink);
}
h1 {
  font-size: 40px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}
.lead {
  margin: 16px 0 0;
  font-size: 18px;
  line-height: 1.6;
  color: var(--pc-ink-2);
}
.feed {
  margin: 12px 0 0;
  font-size: 14px;
}
.feed a {
  color: var(--pc-ink-3);
}
.posts {
  list-style: none;
  margin: 48px 0 0;
  padding: 0;
}
.posts li {
  border-top: 1px solid var(--pc-line);
}
.posts a {
  display: block;
  padding: 28px 0;
  color: inherit;
  text-decoration: none;
}
.posts a:hover h2 {
  color: var(--pc-green);
}
time {
  font-size: 13px;
  color: var(--pc-ink-3);
}
h2 {
  margin: 6px 0 0;
  border: 0;
  padding: 0;
  font-size: 21px;
  line-height: 1.35;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.posts p {
  margin: 8px 0 0;
  color: var(--pc-ink-2);
  line-height: 1.6;
}
</style>
