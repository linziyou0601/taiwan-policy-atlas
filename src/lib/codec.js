/* ==================================================
 * lib/codec.js - 壓縮、base64url 與雜湊
 * --------------------------------------------------
 * - 角色：分享網址把狀態壓縮後寫成 base64url，設定與自訂資料以 sha256 識別版本
 * - 指令：import { packText, unpackText, sha256Hex, fnv1a } from "../lib/codec.js"
 * - 慣例：壓縮使用瀏覽器內建的 CompressionStream（deflate-raw），雜湊使用 Web Crypto，不載入外部函式庫
 * ================================================== */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 壓縮格式，deflate-raw 沒有標頭，網址最短。
 */
const COMPRESSION = "deflate-raw";

/**
 * FNV-1a 雜湊的初值與乘數。
 */
const FNV = { offset: 0x811c9dc5, prime: 0x01000193 };

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 把位元組寫成 base64url（不補 =）。
 * @param {Uint8Array} bytes 位元組。
 * @returns {string}
 */
function toBase64Url(bytes) {
  let binary = "";
  // 逐位元組轉成 btoa 接受的字元
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * 把 base64url 還原成位元組。
 * @param {string} text base64url 字串。
 * @returns {Uint8Array}
 */
function fromBase64Url(text) {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * 讓位元組流過壓縮或解壓縮串流。
 * @param {Uint8Array} bytes 輸入。
 * @param {CompressionStream|DecompressionStream} stream 轉換串流。
 * @returns {Promise<Uint8Array>}
 */
async function pipeBytes(bytes, stream) {
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 壓縮文字並寫成 base64url。
 * @param {string} text 原文。
 * @returns {Promise<string>}
 */
async function packText(text) {
  const bytes = await pipeBytes(new TextEncoder().encode(text), new CompressionStream(COMPRESSION));
  return toBase64Url(bytes);
}

/**
 * 從 base64url 解壓縮回文字。
 * @param {string} packed packText 的結果。
 * @returns {Promise<string>}
 */
async function unpackText(packed) {
  const bytes = await pipeBytes(fromBase64Url(packed), new DecompressionStream(COMPRESSION));
  return new TextDecoder().decode(bytes);
}

/**
 * 計算文字的 sha256。
 * @param {string} text 原文。
 * @returns {Promise<string>} 十六進位字串。
 */
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * FNV-1a 32 位元雜湊，同步計算，用於快取鍵與穩定的打散順序，強度不足以用在安全用途。
 * @param {string} textContent 文字。
 * @returns {number}
 */
function fnv1a(textContent) {
  let hash = FNV.offset;
  // 逐字混入雜湊
  for (let i = 0; i < textContent.length; i += 1) {
    hash ^= textContent.charCodeAt(i);
    hash = Math.imul(hash, FNV.prime) >>> 0;
  }
  return hash;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { packText, unpackText, sha256Hex, fnv1a };
