import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import eslintPluginPrettier from "eslint-plugin-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      import: importX,
      prettier: eslintPluginPrettier,
      "react-hooks": reactHooks,
    },
    settings: {
      "import-x/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
        node: true,
      },
    },
    rules: {
      ...eslintConfigPrettier.rules,
      "prettier/prettier": "error",
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index"
          ],
          pathGroups: [
            { pattern: "@/**", group: "internal" },
            { pattern: "src/**", group: "internal" },
            { pattern: "~/**", group: "internal" },
          ],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/newline-after-import": "error",
      ...reactHooks.configs.recommended.rules,
    },
  },
);
