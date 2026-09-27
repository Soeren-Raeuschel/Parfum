import security from "eslint-plugin-security";

export default [
  security.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
      "eqeqeq": "error"
    }
  }
];