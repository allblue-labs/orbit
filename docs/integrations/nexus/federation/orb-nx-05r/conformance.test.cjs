// Offline assertions over synthetic fixtures. No product module or transport is loaded.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const scope = require('./scope.json');
const repo = path.resolve(__dirname, '../../../../..');
const orbit = require('../../../../../backend/scripts/nexus-contract-validator.cjs');
const nexusPackage = path.resolve(requireArgument('ORB_NX_NEXUS_PACKAGE'));
const { createOrbitCompatibility } = require(
  path.join(
    nexusPackage,
    'dist-compatibility/compatibility/orbit-v2/1.0.0-nexus04c/index.js',
  ),
);
const codecs = createOrbitCompatibility();

function requireArgument(name) {
  const value = process.env[name];
  assert.ok(value, 'Supply the offline input ' + name);
  return value;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function verifyArtifact(root, artifact) {
  const bytes = readFileSync(path.join(root, artifact.path));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    artifact.sha256,
  );
  if (artifact.id) assert.equal(JSON.parse(bytes).$id, artifact.id);
}

function orbitFixture(name) {
  return readJson(path.join(orbit.root, 'examples', name + '.json'));
}

function nexusFixture(name) {
  return readJson(path.join(nexusPackage, 'examples/valid', name + '.json'));
}

function inert(gate) {
  for (const field of [
    'approved',
    'ratified',
    'runtimeEnabled',
    'authorizationVerified',
  ]) {
    assert.equal(gate[field], false, field);
  }
}

function accepted(result, classification = 'ADAPTED_COMPATIBLE') {
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.classification, classification);
  inert(result.gate);
  return result.value;
}

function rejected(result) {
  assert.equal(result.ok, false);
  assert.equal(Object.hasOwn(result, 'value'), false);
  inert(result.gate);
}

test('the review scope pins both frozen specifications and the codec', () => {
  for (const side of ['orbit', 'nexus']) {
    const root = side === 'orbit' ? repo : nexusPackage;
    const manifest = scope[side];
    for (const artifact of [...manifest.schemas, manifest.lock]) {
      verifyArtifact(root, artifact);
    }
  }
  for (const artifact of [
    scope.nexus.adapterLock,
    scope.nexus.adapterSourceManifest,
    scope.nexus.profileCapabilities,
  ]) {
    verifyArtifact(nexusPackage, artifact);
  }
  for (const field of ['approved', 'ratified', 'runtimeEnabled'])
    assert.equal(scope[field], false);
  assert.equal(scope.synchronization, 'DESIGN_ONLY');
  assert.deepEqual(scope.orbitToNexus, [
    'tenant.created',
    'tenant.updated',
    'tenant.suspended',
    'tenant.reactivated',
  ]);
  assert.deepEqual(scope.nexusToOrbit, ['ACK', 'ERROR']);
});

test('all 92 results retain their original classification, including 53 round trips and 16 invalid inputs', () => {
  const before = readJson(requireArgument('ORB_NX_ALIGNMENT_BASELINE'));
  const after = readJson(requireArgument('ORB_NX_ALIGNMENT_CURRENT'));
  const cases = after.cases;
  assert.equal(after.verification, 'PASSED');
  assert.equal(after.conclusion, 'PARTIAL_BLOCKED');
  assert.equal(after.adapterVersion, scope.nexus.adapterVersion);
  assert.deepEqual(cases, before.cases);
  assert.equal(cases.length, 92);
  assert.equal(
    cases.filter((item) => item.direct.structure && item.direct.semantic)
      .length,
    0,
  );
  const adapted = cases.filter(
    (item) => item.classification === 'ADAPTED_COMPATIBLE',
  );
  assert.equal(adapted.length, 53);
  assert.ok(
    adapted.every(
      (item) => item.roundtripLossless && item.targetValidation?.semantic,
    ),
  );
  const invalid = cases.filter((item) => !item.nativeExpected);
  assert.equal(invalid.length, 16);
  assert.ok(
    invalid.every(
      (item) => item.classification === 'BLOCKED' && !item.gate.conformant,
    ),
  );
  assert.equal(
    cases.filter(
      (item) => item.nativeExpected && item.classification === 'BLOCKED',
    ).length,
    23,
  );
  assert.ok(cases.every((item) => item.passed));
  for (const item of cases) inert(item.gate);
});

for (const kind of scope.orbitToNexus) {
  test(kind + ' preserves identity, correlation, and the two counters', () => {
    const event = orbitFixture('valid/event-' + kind);
    event.data.aggregate.version = 7;
    event.data.sequence = 11;
    const frozen = structuredClone(event);
    assert.equal(
      orbit.validateContract('event.schema.json', event).valid,
      true,
    );
    const result = codecs.adaptEvent('ORBIT_1_0_0', event);
    const adapted = accepted(result);
    assert.equal(result.binding.source.version, scope.orbit.version);
    assert.equal(result.binding.target.version, scope.nexus.coreVersion);
    assert.equal(
      result.binding.target.profileVersion,
      scope.nexus.profileVersion,
    );
    for (const key of [
      'id',
      'source',
      'subject',
      'type',
      'correlationid',
      'causationid',
    ]) {
      assert.equal(adapted[key], event[key]);
    }
    for (const key of ['target', 'aggregate', 'sequence', 'payload']) {
      assert.deepEqual(adapted.data[key], event.data[key]);
    }
    assert.deepEqual(accepted(codecs.adaptEvent('NEXUS_04', adapted)), frozen);
    assert.deepEqual(event, frozen);
  });
}

test('known causation in the ACP wire is rejected instead of erased by the adapter', () => {
  const event = nexusFixture('orbit-event-tenant.updated');
  event.causationid = '00000000-0000-7000-8000-000000000003';
  const original = structuredClone(event);
  const result = codecs.adaptEvent('NEXUS_04', event);
  rejected(result);
  assert.equal(result.gate.sourceSchemaValidated, true);
  assert.equal(result.error.code, 'UNREPRESENTABLE_INFORMATION');
  assert.deepEqual(event, original);
  const orbitEvent = orbitFixture('valid/event-tenant.updated');
  orbitEvent.causationid = event.causationid;
  assert.equal(
    orbit.validateContract('event.schema.json', orbitEvent).valid,
    false,
  );
});

test('events with conflicting source, tenant namespace, or aggregate identity are rejected', () => {
  for (const mutate of [
    (event) => {
      event.source = 'urn:allblue:orbit-v2:production:orbit-staging-01';
    },
    (event) => {
      event.subject = 'tenants/' + event.id;
    },
    (event) => {
      event.data.aggregate.id = event.id;
    },
    (event) => {
      event.data.target.productId = 'sintese';
    },
    (event) => {
      event.data.target.instanceId = '1orbit-staging';
      event.source = 'urn:allblue:orbit-v2:staging:1orbit-staging';
    },
  ]) {
    const event = orbitFixture('valid/event-tenant.created');
    mutate(event);
    rejected(codecs.adaptEvent('ORBIT_1_0_0', event));
  }
});

test('unknown versions, integer violations and required fields are rejected explicitly', () => {
  for (const mutate of [
    (event) => {
      event.data.schemaVersion = '1.0.1';
    },
    (event) => {
      delete event.data.aggregate.version;
    },
    (event) => {
      event.data.sequence = 0;
    },
    (event) => {
      event.data.aggregate.version = 1.5;
    },
    (event) => {
      delete event.correlationid;
    },
    (event) => {
      event.correlationid = '00000000000070008000000000000002';
    },
    (event) => {
      delete event.data.payload.provisioningState;
    },
  ]) {
    const event = orbitFixture('valid/event-tenant.created');
    mutate(event);
    rejected(codecs.adaptEvent('ORBIT_1_0_0', event));
  }
  const target = nexusFixture('orbit-event-tenant.created');
  target.data.profileVersion = '1.0.0-proposed.unknown';
  rejected(codecs.adaptEvent('NEXUS_04', target));
});

test('status and reason must be representable without renaming local decisions', () => {
  for (const [kind, reason] of [
    ['suspended', 'RESOLVED'],
    ['reactivated', 'ADMINISTRATIVE'],
  ]) {
    const event = orbitFixture('valid/event-tenant.' + kind);
    event.data.payload.reasonCode = reason;
    rejected(codecs.adaptEvent('ORBIT_1_0_0', event));
  }
});

test('ACK preserves the original receipt tuple and carries no proof of durability or authority', () => {
  const ack = orbitFixture('valid/ack');
  const adapted = accepted(codecs.adaptAck('ORBIT_1_0_0', ack));
  const returned = accepted(codecs.adaptAck('NEXUS_04', adapted));
  assert.deepEqual(returned, ack);
  const tuple = ({ source, eventId, payloadSha256 }) => [
    source,
    eventId,
    payloadSha256,
  ];
  assert.deepEqual(tuple(adapted), tuple(ack));
  assert.notDeepEqual(
    tuple({ ...returned, payloadSha256: 'b'.repeat(64) }),
    tuple(ack),
  );
  rejected(codecs.adaptAck('ORBIT_1_0_0', { ...ack, durablyPersisted: false }));
  rejected(
    codecs.adaptAck('ORBIT_1_0_0', { ...ack, payloadSha256: undefined }),
  );
  rejected(codecs.adaptAck('NEXUS_04', nexusFixture('core-ack')));
});

test('shared integration errors keep their exact code, correlation and retryability', () => {
  const error = orbitFixture('valid/error');
  for (const [code, retryable] of [
    ['INVALID_SCHEMA', false],
    ['UNSUPPORTED_VERSION', false],
    ['FORBIDDEN', false],
    ['MESSAGE_ID_COLLISION', false],
    ['DEPENDENCY_UNAVAILABLE', true],
    ['HISTORY_GAP', false],
  ]) {
    const input = { ...error, code, retryable };
    const adapted = accepted(codecs.adaptError('ORBIT_1_0_0', input));
    assert.deepEqual(accepted(codecs.adaptError('NEXUS_04', adapted)), input);
  }
  for (const code of [
    'UNKNOWN_ORIGIN',
    'MISSING_REQUIRED_INFORMATION',
    'PERMANENT_FAILURE',
  ]) {
    rejected(codecs.adaptError('ORBIT_1_0_0', { ...error, code }));
  }
  rejected(
    codecs.adaptError('ORBIT_1_0_0', { ...error, correlationId: undefined }),
  );
});

test('freshness is directly compatible as a component and refuses a known gap', () => {
  const freshness = nexusFixture('core-freshness');
  const legacyRead = orbitFixture('valid/read');
  legacyRead.freshness = {
    ...legacyRead.freshness,
    state: 'FRESH',
    gapDetected: true,
  };
  assert.equal(
    orbit.validateContract('read.schema.json', legacyRead).valid,
    true,
  );
  for (const format of ['ORBIT_1_0_0', 'NEXUS_04']) {
    assert.deepEqual(
      accepted(codecs.adaptFreshness(format, freshness), 'DIRECT_COMPATIBLE'),
      freshness,
    );
    rejected(
      codecs.adaptFreshness(format, { ...freshness, gapDetected: true }),
    );
    const stale = { ...freshness, gapDetected: true, state: 'STALE' };
    assert.deepEqual(
      accepted(codecs.adaptFreshness(format, stale), 'DIRECT_COMPATIBLE'),
      stale,
    );
  }
});

test('the declared gap from synthetic positions 8 and 10 blocks an otherwise recent freshness claim', () => {
  const watermark = 7;
  for (const [observed, gap] of [
    [[8, 10], true],
    [[8, 9, 10], false],
  ]) {
    const gapDetected = observed.some(
      (sequence, index) => sequence !== watermark + index + 1,
    );
    assert.equal(gapDetected, gap);
    const freshness = { ...nexusFixture('core-freshness'), gapDetected };
    const result = codecs.adaptFreshness('ORBIT_1_0_0', freshness);
    if (gap) rejected(result);
    else accepted(result, 'DIRECT_COMPATIBLE');
  }
});

test('neither declared authority nor a tenant reference becomes a grant or a Party', () => {
  rejected(codecs.authorityMetadata());
  rejected(codecs.linkToParty());
  const event = orbitFixture('valid/event-tenant.created');
  event.data.authority = { role: 'PLATFORM_ADMIN' };
  rejected(codecs.adaptEvent('ORBIT_1_0_0', event));
});
