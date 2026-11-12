/** Synthetic, isolated upstream for the dependency smoke. No database or cloud calls. */
import { createServer } from "node:http";

const claims = {
  sub: "dependency-smoke-user",
  sid: "dependency-smoke-session",
  type: "access",
  organizationId: null,
  businessUnitId: null,
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const accessToken = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic-test-signature`;
const tokens = {
  accessToken,
  refreshToken: "synthetic-refresh-token",
  expiresIn: 3600,
};
const plan = (code, label, amount) => ({
  code,
  label,
  description: "Plano para o smoke de dependências",
  monthlyPrice: String(amount / 100),
  currency: "BRL",
  prices: Object.fromEntries(
    [
      ["MONTHLY", 1],
      ["SEMIANNUAL", 6],
      ["ANNUAL", 12],
    ].map(([interval, months]) => [
      interval,
      { amountMinor: amount * months, currency: "BRL", formatted: "" },
    ]),
  ),
  capabilities: [],
  allocation: { PLATFORM_USERS: { unlimited: false, value: 5 } },
  usage: { SERVICE_ORDERS_CREATED: { unlimited: false, value: 500 } },
});
const proposal = {
  code: "SMOKE-001",
  title: "Manutenção de teste",
  introText: null,
  notes: null,
  customerName: "Cliente de teste",
  emitterName: "Empresa de teste",
  validUntil: null,
  currency: "BRL",
  subtotal: "150.00",
  discount: "0.00",
  total: "150.00",
  serviceAddress: null,
  equipment: [],
  items: [
    {
      description: "Serviço de teste",
      quantity: "1",
      unit: "UN",
      unitPrice: "150.00",
      discount: "0.00",
      total: "150.00",
      notes: null,
    },
  ],
};
const responses = new Map();

createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture").pathname.replace(
    /^\/api\/v1/,
    "",
  );
  const proposalToken = path.match(
    /^\/public\/quotes\/proposals\/([A-Za-z0-9_-]{64})(?:\/response)?$/,
  )?.[1];
  let response = responses.get(proposalToken) ?? null;
  const reply = (status, data) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify(
        status < 400
          ? { success: true, data }
          : {
              success: false,
              error: { code: "NOT_FOUND", message: "Fixture indisponível" },
            },
      ),
    );
  };
  if (path === "/plans/catalog")
    return reply(200, {
      plans: [
        plan("ESSENTIAL", "Essencial", 5990),
        plan("PROFESSIONAL", "Profissional", 14990),
      ],
    });
  if (path === "/identity/login" && req.method === "POST")
    return reply(200, tokens);
  if (path === "/identity/me")
    return reply(200, {
      id: claims.sub,
      displayName: "Pessoa de teste",
      firstName: "Pessoa",
      lastName: "Teste",
      email: "smoke@example.test",
    });
  if (path === "/identity/me/access")
    return reply(200, {
      roles: [],
      permissions: [],
      unitIds: [],
      isOwner: false,
      surfaceAccess: ["WEB"],
    });
  if (path === "/identity/logout") return reply(200, null);
  if (proposalToken && path.endsWith("/response") && req.method === "POST") {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 250_000) return reply(413, null);
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (
        input.decision !== "APPROVE" ||
        input.consentAccepted !== true ||
        !input.signerName ||
        !input.signatureBase64?.startsWith("data:image/png;base64,")
      )
        return reply(400, null);
      response = {
        decision: "APPROVE",
        signerName: input.signerName,
        respondedAt: new Date().toISOString(),
        reason: null,
      };
      responses.set(proposalToken, response);
    } catch {
      return reply(400, null);
    }
    return reply(200, {
      state: "COMPLETED",
      proposal,
      response,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
  }
  if (proposalToken && !path.endsWith("/response"))
    return reply(200, {
      state: response ? "COMPLETED" : "AVAILABLE",
      proposal,
      response,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
  return reply(404, null);
}).listen(17203, "0.0.0.0");
