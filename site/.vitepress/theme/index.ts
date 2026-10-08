import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import Layout from "./Layout.vue";
import Home from "./Home.vue";
import Pricing from "./Pricing.vue";
import BlogIndex from "./BlogIndex.vue";
import PostMeta from "./PostMeta.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("Home", Home);
    app.component("Pricing", Pricing);
    app.component("BlogIndex", BlogIndex);
    app.component("PostMeta", PostMeta);
  },
} satisfies Theme;
