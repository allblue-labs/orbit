const packageName = "com.allbluelabs.orbit";

export function androidAppAssociation(value: string | undefined) {
  const fingerprints =
    value
      ?.trim()
      .split(/[,\s]+/)
      .filter(Boolean) ?? [];
  if (
    fingerprints.length === 0 ||
    fingerprints.some(
      (value) => !/^(?:[\da-f]{2}:){31}[\da-f]{2}$/i.test(value),
    )
  ) {
    return null;
  }
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: [
          ...new Set(fingerprints.map((value) => value.toUpperCase())),
        ],
      },
    },
  ];
}

export function appleAppAssociation(value: string | undefined) {
  const appIdentifier = value?.trim();
  if (
    !appIdentifier ||
    !/^[A-Z\d]{10}\.com\.allbluelabs\.orbit$/.test(appIdentifier)
  )
    return null;

  return {
    applinks: {
      details: [{ appIDs: [appIdentifier], components: [{ "/": "/q/*" }] }],
    },
  };
}

export function mobileAssociationResponse(data: unknown) {
  return data === null
    ? new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      })
    : Response.json(data, {
        headers: { "Cache-Control": "public, max-age=300" },
      });
}
