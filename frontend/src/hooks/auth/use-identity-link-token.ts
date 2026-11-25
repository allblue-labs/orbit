"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  identityLinkToken,
  withoutIdentityToken,
} from "@/lib/identity-link-token";
function store() {
  let held = "";
  return {
    snapshot: () => {
      const incoming = identityLinkToken(new URL(window.location.href));
      if (incoming) held = incoming;
      return held;
    },
    subscribe: (change: () => void) => {
      window.addEventListener("hashchange", change);
      window.addEventListener("popstate", change);
      return () => {
        window.removeEventListener("hashchange", change);
        window.removeEventListener("popstate", change);
      };
    },
  };
}
/** Per-page memory: consume no token on load and scrub secrets from the address/history. */
export function useIdentityLinkToken(): string | null {
  const [source] = useState(store);
  const token = useSyncExternalStore(
    source.subscribe,
    source.snapshot,
    () => null,
  );
  useEffect(() => {
    if (!token) return;
    const url = withoutIdentityToken(new URL(window.location.href));
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  }, [token]);
  return token;
}
