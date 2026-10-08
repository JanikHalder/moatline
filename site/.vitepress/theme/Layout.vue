<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import DefaultTheme from "vitepress/theme";
import { useRouter } from "vitepress";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

const { Layout } = DefaultTheme;
const router = useRouter();

let lenis: Lenis | null = null;
let rafId = 0;
let reduced = false;

function frame(time: number) {
  lenis?.raf(time);
  rafId = requestAnimationFrame(frame);
}

function startLenis() {
  if (reduced || lenis) return;
  lenis = new Lenis({
    duration: 1.05,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    touchMultiplier: 1.2,
  });
  document.documentElement.classList.add("lenis");
  rafId = requestAnimationFrame(frame);
}

function stopLenis() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  lenis?.destroy();
  lenis = null;
  document.documentElement.classList.remove("lenis");
}

function onClick(e: MouseEvent) {
  if (!lenis || e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as HTMLElement | null)?.closest?.(
    "a[href^='#']"
  ) as HTMLAnchorElement | null;
  if (!a) return;
  const id = decodeURIComponent(a.getAttribute("href")!.slice(1));
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  lenis.scrollTo(el, { offset: -72 });
  history.pushState(null, "", `#${id}`);
}

onMounted(() => {
  reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced) startLenis();
  document.addEventListener("click", onClick);
});

onUnmounted(() => {
  document.removeEventListener("click", onClick);
  stopLenis();
});

watch(
  () => router.route.path,
  () => {
    requestAnimationFrame(() => {
      if (lenis) lenis.scrollTo(0, { immediate: true });
      else window.scrollTo(0, 0);
    });
  }
);
</script>

<template>
  <Layout />
</template>
