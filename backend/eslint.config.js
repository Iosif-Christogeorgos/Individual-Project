// Run from the repository root (see the "lint" script) so it covers backend and frontend.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["frontend/gsap.min.js", "**/node_modules/**"] },
  js.configs.recommended,
  {
    rules: {
      // Handlers deliberately replace internal errors with user-facing messages
      "preserve-caught-error": "off",
    },
  },
  {
    files: ["backend/**/*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["frontend/**/*.js"],
    languageOptions: { globals: { ...globals.browser, gsap: "readonly" } },
  },
];
