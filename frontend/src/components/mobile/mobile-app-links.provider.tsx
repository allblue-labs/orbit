"use client";

import { createContext, useContext, type ReactNode } from "react";

const PLACEHOLDER_LINKS = {
  playStore: "https://example.com/orbit/android",
  appStore: "https://example.com/orbit/ios",
};

type MobileAppLinks = typeof PLACEHOLDER_LINKS;
const MobileAppLinksContext = createContext<MobileAppLinks>(PLACEHOLDER_LINKS);

function storeLink(value: string | undefined, fallback: string): string {
  try {
    const url = new URL(value?.trim() ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : fallback;
  } catch {
    return fallback;
  }
}

/** Only these public URLs cross the server/client boundary, at runtime. */
export function MobileAppLinksProvider({
  children,
  links,
}: {
  children: ReactNode;
  links: Partial<MobileAppLinks>;
}) {
  return (
    <MobileAppLinksContext.Provider
      value={{
        playStore: storeLink(links.playStore, PLACEHOLDER_LINKS.playStore),
        appStore: storeLink(links.appStore, PLACEHOLDER_LINKS.appStore),
      }}
    >
      {children}
    </MobileAppLinksContext.Provider>
  );
}

export function useMobileAppLinks() {
  return useContext(MobileAppLinksContext);
}
