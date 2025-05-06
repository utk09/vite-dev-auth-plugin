export type CookieJar = Map<string, string>; // name → value

/** Merge new Set‑Cookie header(s) into jar */
export function storeCookies(
  jar: CookieJar,
  raw: string | string[] | undefined
) {
  if (!raw) return;
  const lines = Array.isArray(raw) ? raw : [raw];
  lines.forEach((line) => {
    const [nv] = line.split(";"); // keep only name=value
    const [name, value] = nv.split("=");
    if (name) jar.set(name.trim(), value.trim());
  });
}

/** serialise jar to single Cookie header */
export function jarToString(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
