import security from "eslint-plugin-security";

export default [
  {
    ignores: ["dist/**", "src/App_old.js", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**"],
  },
  security.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
      "eqeqeq": "error"
    }
  }
];