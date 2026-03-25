/**
 * Browser-safe stub for the jsonlint package.
 * CodeMirror's json-lint addon calls window.jsonlint.parse(text) and expects
 * a SyntaxError to be thrown for invalid JSON. JSON.parse does exactly that.
 */
export const parser = {
  parse(text) {
    JSON.parse(text)
  }
}

export default { parser }
