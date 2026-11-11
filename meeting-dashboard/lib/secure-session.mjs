const enc = new TextEncoder();
const b64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const unb64 = (text) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
async function key(secret) {
  if (!secret || secret.length < 32)
    throw new Error("Session encryption is not configured.");
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", enc.encode(secret)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(secret),
    enc.encode(JSON.stringify(value)),
  );
  return b64(iv) + "." + b64(data);
}
export async function unseal(value, secret, userId) {
  try {
    const [iv, data] = value.split(".");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      await key(secret),
      unb64(data),
    );
    const session = JSON.parse(new TextDecoder().decode(plain));
    return session.userId === userId && session.expires > Date.now()
      ? session.token
      : null;
  } catch {
    return null;
  }
}
