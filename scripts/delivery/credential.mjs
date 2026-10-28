const ENTER = new Set(["\r", "\n"]);
const CTRL_C = "\u0003";
const BACKSPACE = new Set(["\u007f", "\b"]);

/**
 * @typedef {NodeJS.ReadableStream & { isTTY?: boolean, setRawMode?: (mode: boolean) => unknown }} SecretInput
 */

/**
 * Reads a secret at a terminal prompt that echoes nothing. It never looks at
 * the environment and never falls back to a non-terminal input.
 * @param {string} question
 * @param {{ input?: SecretInput, output?: NodeJS.WritableStream }} [streams]
 * @returns {Promise<string>}
 */
export function promptSecret(
  question,
  { input = process.stdin, output = process.stderr } = {},
) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("a hidden prompt needs a terminal"));
  }
  return new Promise((resolve, reject) => {
    let answer = "";
    /** @param {Error | null} error */
    const finish = (error) => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else if (!answer.trim()) reject(new Error("no token entered"));
      else resolve(answer.trim());
    };
    /** @param {Buffer | string} chunk */
    function onData(chunk) {
      for (const char of String(chunk)) {
        if (ENTER.has(char)) return finish(null);
        if (char === CTRL_C) return finish(new Error("cancelled"));
        if (BACKSPACE.has(char)) answer = answer.slice(0, -1);
        else answer += char;
      }
    }
    output.write(question);
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
  });
}
