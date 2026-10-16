/**
 * @param {string} question
 * @param {{ input?: NodeJS.ReadableStream & { isTTY?: boolean, setRawMode?: (mode: boolean) => unknown }, output?: NodeJS.WritableStream }} [streams]
 * @returns {Promise<string>}
 */
export async function promptSecret(question, streams) {
  void question;
  void streams;
  return "";
}
