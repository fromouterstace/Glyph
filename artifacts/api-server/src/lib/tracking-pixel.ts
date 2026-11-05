/**
 * Transparent 1x1 GIF89a. The LZW stream includes clear, pixel and end codes
 * [4, 0, 5]. Do not use the shortened single-byte stream: it omits the complete
 * end code, even though tolerant browsers can still render it.
 */
export const transparentGif = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64",
);
