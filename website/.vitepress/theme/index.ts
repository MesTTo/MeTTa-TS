// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import MettaRunner from "./MettaRunner.vue";
import MeTTaGrapher from "./MeTTaGrapher.vue";
import "./custom.css";

// Extend the default VitePress theme with the live MeTTa sandbox component <MettaRunner> and the visual
// node editor <MeTTaGrapher>, available in any page.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("MettaRunner", MettaRunner);
    app.component("MeTTaGrapher", MeTTaGrapher);
  },
} satisfies Theme;
