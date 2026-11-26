/** Specification conformance, not an integration test or authorization engine. */
const contractTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  root,
  catalog,
  machine,
  validateContract,
  validateTransition,
} = require('./nexus-contract-validator.cjs');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file)));
const example = (name) => read('examples/valid/' + name + '.json');
const fixtures = read('examples/manifest.json');

contractTest(
  'future historical price reference is opaque and does not authorize a price command',
  () => {
    const event = example('event-subscription.changed');
    event.data.payload.priceVersionRef =
      'registry-orbit-test-catalog-1-price-7';
    assert.equal(validateContract('event.schema.json', event).valid, true);
    const command = example('command');
    command.parameters.priceVersionRef = event.data.payload.priceVersionRef;
    assert.equal(validateContract('command.schema.json', command).valid, false);
  },
);

contractTest(
  'unknown legacy does not invent a financial period or price version',
  () => {
    for (const [field, value] of [
      ['currentPeriodEnd', '2027-01-01T00:00:00Z'],
      ['priceVersionRef', 'made-up-price'],
    ]) {
      const read = example('read-unknown-subscription');
      read.data[field] = value;
      assert.equal(validateContract('read.schema.json', read).valid, false);
    }
  },
);

contractTest(
  'canonical subscription read requires a real canonical identity',
  () => {
    const input = example('read-unknown-subscription');
    input.data.source = 'CANONICAL';
    assert.equal(validateContract('read.schema.json', input).valid, false);
  },
);

for (const fixture of fixtures) {
  contractTest(
    `fixture ${fixture.file}: expected ${fixture.valid ? 'valid' : 'invalid'}`,
    () => {
      const result = validateContract(
        fixture.schema,
        read('examples/' + fixture.file),
      );
      assert.equal(result.valid, fixture.valid, JSON.stringify(result.errors));
    },
  );
}

const incompatible = [
  [
    'source product mismatch',
    'event',
    'event-tenant.created',
    (x) => {
      x.source = x.source.replace('orbit-v2', 'nuance');
    },
  ],
  [
    'type product mismatch',
    'event',
    'event-tenant.created',
    (x) => {
      x.type = x.type.replace('orbit-v2', 'nuance');
    },
  ],
  [
    'cross environment',
    'event',
    'event-tenant.created',
    (x) => {
      x.data.target.environment = 'production';
    },
  ],
  [
    'cross tenant subject',
    'event',
    'event-tenant.created',
    (x) => {
      x.subject = 'tenants/another-tenant';
    },
  ],
  [
    'wrong aggregate tenant',
    'event',
    'event-tenant.created',
    (x) => {
      x.data.aggregate.id = 'different';
    },
  ],
  [
    'wrong aggregate subscription',
    'event',
    'event-subscription.changed',
    (x) => {
      x.data.aggregate.id = 'different';
    },
  ],
  [
    'no persisted sequence',
    'event',
    'event-tenant.created',
    (x) => {
      x.data.sequence = 0;
    },
  ],
  [
    'wrong occurrence time',
    'event',
    'event-tenant.created',
    (x) => {
      x.time = '2026-11-16T00:00:00Z';
    },
  ],
  [
    'unknown event type',
    'event',
    'event-tenant.created',
    (x) => {
      x.type = 'com.allbluelabs.orbit-v2.support.ticket_created.v1';
    },
  ],
  [
    'signed document URL leakage',
    'event',
    'event-tenant.created',
    (x) => {
      x.data.signedUrl = 'https://storage.example.invalid/private';
    },
  ],
  [
    'Prisma entity leakage',
    'event',
    'event-tenant.created',
    (x) => {
      x.data.payload.organization = { ownerUserId: 'user-demo' };
    },
  ],
  [
    'new optional field breaks a closed old consumer',
    'event',
    'event-tenant.created',
    (x) => {
      x.data.payload.optionalNewField = true;
    },
  ],
  [
    'floating money',
    'event',
    'event-billing.payment_succeeded',
    (x) => {
      x.data.payload.amountMinor = 1.99;
    },
  ],
  [
    'unsafe integer money',
    'event',
    'event-billing.payment_succeeded',
    (x) => {
      x.data.payload.amountMinor = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'zero is not new Stripe cash',
    'event',
    'event-billing.payment_succeeded',
    (x) => {
      x.data.payload.amountMinor = 0;
    },
  ],
  [
    'invoice status is not cash evidence',
    'event',
    'event-billing.payment_succeeded',
    (x) => {
      x.data.payload.confirmationBasis = 'INVOICE_PAID';
    },
  ],
  [
    'payment observation is not occurredAt',
    'event',
    'event-billing.payment_succeeded',
    (x) => {
      x.occurrencebasis = 'RECORDED';
    },
  ],
  [
    'staging cannot emit LIVE payments',
    'event',
    'event-billing.payment_succeeded',
    (x) => {
      x.data.payload.billing.mode = 'LIVE';
    },
  ],
  [
    'payment ID differs from aggregate',
    'event',
    'event-billing.payment_succeeded',
    (x) => {
      x.data.payload.paymentId = 'another-payment';
    },
  ],
  [
    'dispute is not refund',
    'event',
    'event-billing.refund_completed',
    (x) => {
      x.data.payload.kind = 'DISPUTE';
    },
  ],
  [
    'refund failure is not completed',
    'event',
    'event-billing.refund_completed',
    (x) => {
      x.data.payload.status = 'FAILED';
    },
  ],
  [
    'unknown subscription not confirmed',
    'event',
    'event-subscription.changed',
    (x) => {
      x.data.payload.status = 'UNKNOWN';
    },
  ],
  [
    'float minor values in billing read',
    'read',
    'read-billing-out-of-band',
    (x) => {
      x.data.amountMinor = 1.99;
    },
  ],
  [
    'owner PII in directory',
    'directory',
    'directory',
    (x) => {
      x.items[0].ownerEmail = 'owner@example.invalid';
    },
  ],
  [
    'unknown legacy cannot claim ACTIVE',
    'read',
    'read-unknown-subscription',
    (x) => {
      x.data.status = 'ACTIVE';
    },
  ],
  [
    'metadata write cannot set status',
    'command',
    'command-tenant.update',
    (x) => {
      x.parameters.subscriptionStatus = 'ACTIVE';
    },
  ],
  [
    'arbitrary Stripe price',
    'command',
    'command',
    (x) => {
      x.parameters.priceId = 'price_not_allowed';
    },
  ],
  [
    'manual trial grant',
    'command',
    'command',
    (x) => {
      x.parameters.trialDays = 30;
    },
  ],
  [
    'password sent through federation',
    'command',
    'command-tenant.provision',
    (x) => {
      x.parameters.ownerPassword = 'not-a-real-password';
    },
  ],
  [
    'provision cannot select an existing tenant',
    'command',
    'command-tenant.provision',
    (x) => {
      x.target.tenantId = 'tenant-other';
    },
  ],
  [
    'tenant update needs target',
    'command',
    'command-tenant.update',
    (x) => {
      delete x.target.tenantId;
    },
  ],
  [
    'subscription command requires subscription CAS',
    'command',
    'command',
    (x) => {
      x.precondition.aggregate = 'TENANT';
    },
  ],
  [
    'negative canonical version',
    'command',
    'command',
    (x) => {
      x.precondition.version = '-1';
    },
  ],
  [
    'unsupported plan for Orbit',
    'command',
    'command',
    (x) => {
      x.parameters.planCode = 'ARBITRARY_PLAN';
    },
  ],
  [
    'invalid interval',
    'command',
    'command',
    (x) => {
      x.parameters.billingInterval = 'EVERY_MINUTE';
    },
  ],
  [
    'excessive command lifetime',
    'command',
    'command',
    (x) => {
      x.expiresAt = '2027-11-15T12:00:00Z';
    },
  ],
  [
    'expiry before issue',
    'command',
    'command',
    (x) => {
      x.expiresAt = '2026-11-15T11:00:00Z';
    },
  ],
  [
    'wrong result for cancellation',
    'receipt',
    'receipt',
    (x) => {
      x.commandType = 'subscription.request_cancel.v1';
    },
  ],
  [
    'wrong product confirms',
    'receipt',
    'receipt',
    (x) => {
      x.confirmedBy = 'nuance';
    },
  ],
  [
    'success without effect',
    'receipt',
    'receipt',
    (x) => {
      x.effect = { kind: 'NONE' };
    },
  ],
  [
    'not yet applied cannot claim final effect',
    'receipt',
    'receipt-accepted',
    (x) => {
      x.effect = example('receipt').effect;
    },
  ],
  [
    'terminal uncertain external result',
    'receipt',
    'receipt-failed',
    (x) => {
      x.error.code = 'RECONCILIATION_REQUIRED';
    },
  ],
  [
    'failed without diagnostic',
    'receipt',
    'receipt-failed',
    (x) => {
      delete x.error;
    },
  ],
  [
    'already effective is not a future schedule',
    'receipt',
    'receipt',
    (x) => {
      x.effect.effectiveAt = '2026-10-15T12:00:00Z';
    },
  ],
  [
    'cannot claim paid on provisioning',
    'receipt',
    'receipt-provisioned-pending-payment',
    (x) => {
      x.effect.access = 'ACTIVE';
    },
  ],
  [
    'provisioned requires queued setup',
    'receipt',
    'receipt-provisioned-pending-payment',
    (x) => {
      x.effect.ownerSetup = 'PENDING';
    },
  ],
  [
    'link active without verified tenant',
    'link',
    'link',
    (x) => {
      delete x.target.tenantId;
    },
  ],
  [
    'link not verified',
    'link',
    'link',
    (x) => {
      x.verifiedAt = null;
    },
  ],
  [
    'PII cannot authorize link',
    'link',
    'link',
    (x) => {
      x.documentNumber = '00000000000';
    },
  ],
  [
    'metadata must not declare generic global grant',
    'authority-context',
    'authority',
    (x) => {
      x.actions = ['PLATFORM_ADMIN'];
    },
  ],
  [
    'no bearer in metadata',
    'authority-context',
    'authority',
    (x) => {
      x.accessToken = 'not-a-token';
    },
  ],
  [
    'reversed usage window',
    'read',
    'read-usage-future',
    (x) => {
      x.data.metric.window.until = x.data.metric.window.from;
    },
  ],
  [
    'invalid civil timezone',
    'read',
    'read-usage-future',
    (x) => {
      x.data.metric.window.timeZone = 'Somewhere/Invalid';
    },
  ],
];
for (const [name, schema, fixture, mutate] of incompatible)
  contractTest(name, () => {
    const input = example(fixture);
    mutate(input);
    assert.equal(validateContract(schema + '.schema.json', input).valid, false);
  });

for (const name of ['command', 'receipt', 'link', 'read', 'ack', 'authority']) {
  const schema = name === 'authority' ? 'authority-context' : name;
  for (const version of ['0.9.0', '1.0.1', '1.1.0', '2.0.0'])
    contractTest(`${schema} does not silently accept ${version}`, () => {
      const input = example(name);
      input.protocolVersion = version;
      assert.equal(
        validateContract(schema + '.schema.json', input).valid,
        false,
      );
    });
}
for (const key of [
  'commandId',
  'target',
  'grantId',
  'delegationRef',
  'precondition',
  'parameters',
  'expiresAt',
])
  contractTest(`command requires ${key}`, () => {
    const input = example('command');
    delete input[key];
    assert.equal(validateContract('command.schema.json', input).valid, false);
  });
for (const key of [
  'source',
  'id',
  'type',
  'dataschema',
  'correlationid',
  'observedat',
  'data',
])
  contractTest(`event requires ${key}`, () => {
    const input = example('event-tenant.created');
    delete input[key];
    assert.equal(validateContract('event.schema.json', input).valid, false);
  });

contractTest(
  'unknown occurrence omits time instead of fabricating history',
  () => {
    const input = example('event-billing.refund_completed');
    input.occurrencebasis = 'UNKNOWN';
    delete input.time;
    assert.equal(validateContract('event.schema.json', input).valid, true);
  },
);
for (const productId of ['orbit-v1', 'nuance', 'sintese'])
  contractTest(
    `generic envelope represents synthetic ${productId} without certifying its adapter`,
    () => {
      const input = example('event-tenant.created');
      input.data.target.productId = productId;
      input.source = input.source.replace('orbit-v2', productId);
      input.type = input.type.replace('orbit-v2', productId);
      assert.equal(validateContract('event.schema.json', input).valid, true);
    },
  );

const receiptFor = (state) =>
  example(state === 'SUCCEEDED' ? 'receipt' : 'receipt-' + state.toLowerCase());
for (const [from, allowed] of Object.entries(machine.transitions))
  for (const to of Object.keys(machine.transitions))
    contractTest(`receipt transition ${from} -> ${to}`, () => {
      const before = receiptFor(from),
        after = receiptFor(to);
      after.receiptVersion = before.receiptVersion + 1;
      assert.equal(validateTransition(before, after), allowed.includes(to));
    });
for (const key of [
  'commandId',
  'receiptId',
  'target',
  'acceptedAt',
  'correlationId',
])
  contractTest(`receipt cannot change identity ${key}`, () => {
    const before = receiptFor('ACCEPTED'),
      after = receiptFor('EXECUTING');
    after.receiptVersion++;
    if (key === 'target') after.target.tenantId = 'another-tenant';
    else if (key === 'acceptedAt') after.acceptedAt = '2026-11-15T11:00:00Z';
    else after[key] = '00000000-0000-7000-8000-000000000099';
    assert.equal(validateTransition(before, after), false);
  });
contractTest(
  'receipt target equality does not depend on JSON property order',
  () => {
    const before = receiptFor('ACCEPTED'),
      after = receiptFor('EXECUTING');
    after.receiptVersion++;
    after.target = Object.fromEntries(Object.entries(after.target).reverse());
    assert.equal(validateTransition(before, after), true);
  },
);
contractTest('receipt version must advance', () => {
  assert.equal(
    validateTransition(receiptFor('ACCEPTED'), receiptFor('EXECUTING')),
    false,
  );
});
contractTest(
  'every schema compiles and is a versioned independent JSON Schema',
  () => {
    for (const name of catalog.schemas) {
      const s = read('schemas/' + name);
      assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema');
      assert.equal(s.$id, catalog.schemaBase + name);
      assert.ok(!JSON.stringify(s).includes('@prisma'));
    }
  },
);
contractTest(
  'OpenAPI references resolve locally; every operation has explicit scoped machine and signature requirements',
  () => {
    const api = read('openapi.json');
    assert.equal(api.openapi, '3.1.1');
    assert.equal(api.info.version, '1.0.0');
    assert.equal(api['x-runtime-implemented'], false);
    assert.equal(api['x-approval-status'], 'PENDING_NEXUS_DECISION');
    const ids = new Set();
    function references(value) {
      if (!value || typeof value !== 'object') return;
      if (value.$ref) {
        const [file, fragment] = value.$ref.split('#');
        const target = file ? read(file) : api;
        let node = target;
        for (const part of (fragment || '').split('/').slice(1))
          node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
        assert.ok(node, `unresolved ${value.$ref}`);
      }
      for (const child of Object.values(value)) references(child);
    }
    references(api);
    for (const [url, item] of Object.entries(api.paths))
      for (const [method, operation] of Object.entries(item)) {
        assert.ok(['get', 'post'].includes(method));
        assert.ok(!ids.has(operation.operationId));
        ids.add(operation.operationId);
        assert.ok(operation.responses['200'] || operation.responses['202']);
        for (const requirement of operation.security) {
          assert.ok(requirement.federatedOAuth.length > 0);
          assert.deepEqual(requirement.httpMessageSignature, []);
          for (const scope of requirement.federatedOAuth)
            assert.ok(
              api.components.securitySchemes.federatedOAuth.flows
                .clientCredentials.scopes[scope],
            );
        }
        for (const server of operation.servers || api.servers)
          assert.equal(
            new URL(server.url).hostname.endsWith('.example.invalid'),
            true,
          );
        for (const variable of url.matchAll(/\{([^}]+)\}/g))
          assert.ok(
            operation.parameters.some(
              (p) => p.in === 'path' && p.name === variable[1] && p.required,
            ),
          );
        assert.ok(operation.responses['401']);
        assert.ok(operation.responses['403']);
      }
    assert.ok(
      api.paths['/commands'].post.parameters.some(
        (p) => p.name === 'Idempotency-Key' && p.required,
      ),
    );
  },
);
contractTest(
  'frozen candidate package cannot drift or drop historical examples unnoticed',
  () => {
    const lock = read('compatibility-lock.json');
    assert.equal(lock.protocolVersion, '1.0.0');
    for (const [file, sha] of Object.entries(lock.files))
      assert.equal(
        createHash('sha256')
          .update(fs.readFileSync(path.join(root, file)))
          .digest('hex'),
        sha,
        file,
      );
    const actualExamples = fs
      .readdirSync(path.join(root, 'examples/valid'))
      .map((f) => 'valid/' + f)
      .concat(
        fs
          .readdirSync(path.join(root, 'examples/invalid'))
          .map((f) => 'invalid/' + f),
      )
      .sort();
    assert.deepEqual(actualExamples, fixtures.map((f) => f.file).sort());
    assert.deepEqual(
      fs.readdirSync(path.join(root, 'schemas')).sort(),
      catalog.schemas,
    );
  },
);

contractTest(
  'the corporate administration OpenAPI is scoped, closed and consistent with its examples',
  () => {
    const Ajv = require('ajv/dist/2020').default;
    const addFormats = require('ajv-formats');
    const api = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          '../../docs/integrations/nexus/administrative/openapi.json',
        ),
      ),
    );
    assert.equal(api.openapi, '3.1.0');
    assert.deepEqual(api.security, [{ TechnicalBearer: [] }]);
    const resolve = (ref) => {
      assert.ok(ref.startsWith('#/components/'), ref);
      return ref
        .slice(2)
        .split('/')
        .reduce((node, key) => node?.[key], api);
    };
    function checkReferences(node) {
      if (!node || typeof node !== 'object') return;
      if (node.$ref) assert.ok(resolve(node.$ref), node.$ref);
      Object.values(node).forEach(checkReferences);
    }
    checkReferences(api);

    const base = 'https://contracts.example.test/orbit/corporate-admin';
    const ajv = new Ajv({
      strict: true,
      strictTypes: false,
      strictRequired: false,
    });
    addFormats(ajv);
    const schemaPointer = (ref) =>
      ref.replace('#/components/schemas/', '#/$defs/');
    const definitions = JSON.parse(
      JSON.stringify(api.components.schemas, (key, value) =>
        key === '$ref' ? schemaPointer(value) : value,
      ),
    );
    ajv.addSchema({ $defs: definitions }, base);
    const registry = '/api/v1/corporate-admin/organizations';
    for (const [url, method, scope] of [
      [registry, 'get', 'organizations:read'],
      [registry + '/{id}', 'get', 'organizations:read'],
      [registry + '/{id}', 'patch', 'organizations:write'],
    ]) {
      const op = api.paths[url][method];
      assert.equal(op['x-required-capability'], scope);
      const parameters = op.parameters.map((p) =>
        p.$ref ? resolve(p.$ref) : p,
      );
      if (url.endsWith('/{id}'))
        assert.equal(
          parameters.find((p) => p.in === 'path' && p.name === 'id')?.required,
          true,
        );
      const administrator = parameters.find(
        (p) => p.name === 'X-Nexus-Administrator-Id',
      );
      assert.equal(administrator?.required, method === 'patch');
      const { schema, example } =
        op.responses['200'].content['application/json'];
      const validate = ajv.getSchema(base + schemaPointer(schema.$ref));
      assert.ok(validate(example), JSON.stringify(validate.errors));
      const unsafe = structuredClone(example);
      (unsafe.data.items?.[0] ?? unsafe.data).secretHash = 'synthetic';
      assert.equal(validate(unsafe), false);
      if (op.requestBody) {
        const { schema, example } = op.requestBody.content['application/json'];
        const validate = ajv.getSchema(base + schemaPointer(schema.$ref));
        assert.ok(validate(example), JSON.stringify(validate.errors));
        assert.equal(
          validate({ expectedUpdatedAt: example.expectedUpdatedAt }),
          false,
        );
        assert.equal(validate({ ...example, planCode: 'ESSENTIAL' }), false);
      }
    }
    const provisioning = '/api/v1/corporate-admin/tenant-provisionings/{id}';
    for (const [url, method, capability, successes, hasKey] of [
      [registry, 'post', 'organizations:provision', [201, 202], true],
      [provisioning, 'get', 'organizations:provisioning:read', [200], false],
      [
        provisioning + '/resume',
        'post',
        'organizations:provision',
        [200, 202],
        false,
      ],
      [
        registry + '/{id}/operational-status',
        'post',
        {
          SUSPENDED: 'organizations:suspend',
          ACTIVE: 'organizations:reactivate',
        },
        [201],
        true,
      ],
    ]) {
      const op = api.paths[url][method];
      assert.deepEqual(
        op['x-required-capability'] ?? op['x-required-capability-by-status'],
        capability,
      );
      const headers = op.parameters.map((p) => (p.$ref ? resolve(p.$ref) : p));
      assert.equal(
        headers.find((p) => p.name === 'X-Nexus-Administrator-Id')?.required,
        method === 'post',
      );
      assert.equal(
        headers.some((p) => p.name === 'Idempotency-Key' && p.required),
        hasKey,
      );
      for (const status of successes) {
        const { schema, example } =
          op.responses[status].content['application/json'];
        const validate = ajv.getSchema(base + schemaPointer(schema.$ref));
        assert.ok(validate(example), JSON.stringify(validate.errors));
        assert.equal(
          validate({
            ...example,
            data: { ...example.data, internalToken: 'synthetic' },
          }),
          false,
        );
      }
      if (op.requestBody) {
        const { schema, example } = op.requestBody.content['application/json'];
        const validate = ajv.getSchema(base + schemaPointer(schema.$ref));
        assert.ok(validate(example), JSON.stringify(validate.errors));
        assert.equal(
          validate({ ...example, subscriptionStatus: 'ACTIVE' }),
          false,
        );
        if (example.owner)
          assert.equal(
            validate({
              ...example,
              owner: { ...example.owner, password: 'synthetic' },
            }),
            false,
          );
      }
    }
  },
);
