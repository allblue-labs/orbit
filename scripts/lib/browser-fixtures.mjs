import { randomUUID } from "node:crypto";

/** The historical browser scenarios use named synthetic data, never a developer tenant. */
export async function browserFixtures(env) {
  if (
    !/^orbit_e2e_[a-f0-9]{16}$/.test(env.ORBIT_E2E_DATABASE ?? "") ||
    new URL(env.ORBIT_API_URL).hostname !== "127.0.0.1"
  )
    throw new Error(
      "Browser fixtures require the disposable integration runner",
    );
  let token;
  async function api(method, path, data, headers = {}) {
    const response = await fetch(`${env.ORBIT_API_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    if (!response.ok)
      throw new Error(
        `Browser fixture ${method} ${path} failed (${response.status})`,
      );
    return (await response.json()).data;
  }
  token = (
    await api("POST", "/identity/login", {
      email: env.OWNER_EMAIL,
      password: env.OWNER_PASSWORD,
    })
  ).accessToken;
  const organization = await api("GET", "/organizations/current");
  const unit = organization.businessUnits[0].id;
  const roles = await api("GET", "/organizations/current/roles");
  const fieldRole = roles.find((role) => role.key === "FIELD_TECHNICIAN");
  const officeRole = roles.find((role) => role.key === "VIEWER");
  if (!fieldRole || !officeRole)
    throw new Error("Browser fixture requires the field role catalogue");
  const profiles = [
    ["Ana", "Campo", true, false, true],
    ["Bruno", "Responsavel", false, true, true],
    ["Carla", "Dupla", true, true, true],
    ["Diego", "Escritorio", false, false, true],
    ["Elena", "Inativa", true, false, false],
  ];
  const members = new Map();
  for (const [firstName, lastName, field, technical, active] of profiles) {
    const created = await api("POST", "/organizations/current/team/members", {
      email: `${firstName.toLowerCase()}.browser@orbit.local`,
      firstName,
      lastName,
      roleId: field ? fieldRole.id : officeRole.id,
      businessUnitIds: [unit],
    });
    members.set(firstName, created.member.userId);
    if (firstName !== "Diego")
      await api(
        "PATCH",
        `/workforce/members/${created.member.userId}/professional-profile`,
        {
          fieldTechnicianEnabled: field,
          technicalResponsibleEnabled: technical,
          active,
        },
      );
  }
  const customer = await api("POST", "/customers", {
    type: "COMPANY",
    legalName: "Cliente sintético dos cenários web",
  });
  const asset = await api("POST", "/assets", {
    businessUnitId: unit,
    customerId: customer.id,
    category: "EQUIPMENT",
    name: "Split Cassete",
  });
  const plan = await api("POST", "/pmoc/plans", {
    businessUnitId: unit,
    customerId: customer.id,
    code: "PMOC-2026-001",
    name: "Plano de referência E2E",
    technicalResponsibleUserId: members.get("Bruno"),
    startsOn: new Date().toISOString().slice(0, 10),
    frequencyAmount: 6,
    frequencyUnit: "MONTHS",
    assetIds: [asset.id],
  });
  await api("POST", `/pmoc/plans/${plan.id}/activate`, {});
  const types = await api("GET", "/rvt/maintenance-types");
  const weekly = types.find((type) => type.key === "WEEKLY");
  if (!weekly)
    throw new Error("Browser fixture requires the maintenance type catalogue");
  await api(
    "POST",
    "/rvt/ad-hoc/executions",
    {
      businessUnitId: unit,
      customerId: customer.id,
      name: "Visita de referência E2E",
      maintenanceTypeId: weekly.id,
      timezone: "America/Recife",
      serviceLocation: { city: "Recife" },
      procedure: { items: [] },
      equipmentIds: [asset.id],
    },
    { "idempotency-key": randomUUID() },
  );
  await api("POST", "/checklist-templates", {
    key: "BROWSER_PREVENTIVA",
    name: "Manutenção preventiva",
    operationKind: "MAINTENANCE",
    isGeneral: false,
    items: [
      {
        key: "filtros",
        label: "Limpeza dos filtros",
        type: "BOOLEAN",
        required: false,
      },
    ],
  });
  console.log(
    "Browser reference fixtures created through the authenticated API.",
  );
}
