// End-to-end encryption for travel documents.
// The group code never leaves the phone: it is stretched with PBKDF2 into an AES-256-GCM key,
// and only scrambled text is stored in the database. Without the code nobody can read it.

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const CHECK = "chongqingga-ok";

async function deriveKey(code, saltB64) {
  const base = await crypto.subtle.importKey("raw", enc.encode(code.normalize("NFKC").trim().toLowerCase()), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { cipher: b64(c), iv: b64(iv) };
}

export async function unseal(key, cipher, iv) {
  const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(cipher));
  return JSON.parse(dec.decode(p));
}

// Admin: make a new lock for a code. Stored publicly; it only lets a phone check a code is right.
export async function makeVault(code) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(code, salt);
  const { cipher, iv } = await seal(key, { ok: CHECK });
  return { salt, check: cipher, iv };
}

// Returns the key if the code is right, otherwise null.
export async function unlock(code, vault) {
  if (!code || !vault) return null;
  const key = await deriveKey(code, vault.salt);
  try { return (await unseal(key, vault.check, vault.iv)).ok === CHECK ? key : null; } catch { return null; }
}
