import typescriptEslint from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    files: ["src/**/*.ts", "test/**/*.ts", "test-functional/**/*.ts", "example/**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier: prettier,
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      ...eslintConfigPrettier.rules,
      "prettier/prettier": "error",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
