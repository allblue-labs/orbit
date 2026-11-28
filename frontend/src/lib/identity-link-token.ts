/** A fragment never reaches the proxy. Query fallback preserves previously shared links. */
export function identityLinkToken(url: URL): string {
  return (
    new URLSearchParams(url.hash.slice(1)).get("token") ??
    url.searchParams.get("token") ??
    ""
  );
}
export function withoutIdentityToken(value: URL): URL {
  const url = new URL(value);
  url.searchParams.delete("token");
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.has("token")) {
    fragment.delete("token");
    url.hash = fragment.toString();
  }
  return url;
}
