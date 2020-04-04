module.exports = {
  env: {
    browser: true,
    es6: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "google",
    "prettier",
    "prettier/@typescript-eslint",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "tsconfig.json",
    sourceType: "module",
  },
  plugins: ["prettier", "@typescript-eslint", "prefer-arrow"],
  rules: {
    "prettier/prettier": "error",
    "valid-jsdoc": "off", // This is deprecated but included in recommended configs.
    "require-jsdoc": "off", // This rule is deprecated and superseded by jsdoc/require-jsdoc.
  },
};
