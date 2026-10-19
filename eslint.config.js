const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["test/native/build/"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node
    }
  }
];
