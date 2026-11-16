// i18next-parser.config.js
// https://github.com/i18next/i18next-parser#options
export default {
  contextSeparator: "_",
  createOldCatalogs: false,
  keepRemoved: true,
  defaultNamespace: "translation",
  defaultValue: "",
  indentation: 2,
  keySeparator: ".",
  lexers: {
    js: ["JavascriptLexer"],
    ts: ["JavascriptLexer"],
    jsx: ["JsxLexer"],
    tsx: ["JsxLexer"],
    default: ["JavascriptLexer"],
  },
  lineEnding: "auto",
  locales: ["en", "de", "es", "nl"],
  namespaceSeparator: ":",
  output: "src/locales/$LOCALE.json",
  input: ["src/**/*.{js,jsx,ts,tsx}"],
  sort: false,
  verbose: false,
  failOnWarnings: false,
  failOnUpdate: false,
};
