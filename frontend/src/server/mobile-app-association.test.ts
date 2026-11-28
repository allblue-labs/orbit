import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as androidAssociation } from "../../app/.well-known/assetlinks.json/route";
import { GET as appleAssociation } from "../../app/.well-known/apple-app-site-association/route";

afterEach(() => vi.unstubAllEnvs());

describe("associação das etiquetas com o app", () => {
  it("publica o certificado e o pacote Android", async () => {
    const fingerprint = Array.from({ length: 32 }, () => "ab").join(":");
    vi.stubEnv("ORBIT_ANDROID_APP_LINK_SHA256", fingerprint);
    const response = androidAssociation();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.allbluelabs.orbit",
          sha256_cert_fingerprints: [fingerprint.toUpperCase()],
        },
      },
    ]);
  });

  it("publica a associação iOS somente para o caminho das etiquetas", async () => {
    vi.stubEnv(
      "ORBIT_IOS_APP_LINK_IDENTIFIER",
      "ABCDE12345.com.allbluelabs.orbit",
    );
    const response = appleAssociation();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      applinks: {
        details: [
          {
            appIDs: ["ABCDE12345.com.allbluelabs.orbit"],
            components: [{ "/": "/q/*" }],
          },
        ],
      },
    });
  });

  it("recusa associações ausentes ou inválidas", () => {
    vi.stubEnv("ORBIT_ANDROID_APP_LINK_SHA256", "");
    vi.stubEnv("ORBIT_IOS_APP_LINK_IDENTIFIER", "ABCDE12345.com.outro.app");
    expect(androidAssociation().status).toBe(404);
    expect(appleAssociation().status).toBe(404);
  });
});
