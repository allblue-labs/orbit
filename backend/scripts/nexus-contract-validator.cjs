/** Offline specification checks only. Never imported by the Orbit application. */
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const Ajv = require('ajv/dist/2020').default;
const formats = require('ajv-formats');

const root = path.resolve(
  __dirname,
  '../../docs/integrations/nexus/federation/1.0.0',
);
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json')));
const machine = JSON.parse(
  fs.readFileSync(path.join(root, 'state-machine.json')),
);
const ajv = new Ajv({
  allErrors: true,
  strict: true,
  strictTypes: false,
  strictRequired: false,
});
formats(ajv);
for (const name of catalog.schemas) {
  ajv.addSchema(JSON.parse(fs.readFileSync(path.join(root, 'schemas', name))));
}
const validators = Object.fromEntries(
  catalog.schemas.map((name) => [
    name,
    ajv.getSchema(catalog.schemaBase + name),
  ]),
);
const copy = (value) => structuredClone(value);

function semanticErrors(name, value) {
  const errors = [];
  const demand = (condition, code) => {
    if (!condition) errors.push(code);
  };
  const time = (value) => Date.parse(value);
  if (value.issuedAt && value.expiresAt) {
    demand(time(value.expiresAt) > time(value.issuedAt), 'INVALID_EXPIRY');
    demand(
      time(value.expiresAt) - time(value.issuedAt) <= 300_000,
      'EXCESSIVE_LIFETIME',
    );
  }
  if (name === 'event.schema.json') {
    const { target, payload, aggregate } = value.data;
    const eventName = value.type
      .replace(`com.allbluelabs.${target.productId}.`, '')
      .replace(/\.v1$/, '');
    demand(catalog.eventTypes.includes(eventName), 'EVENT_PRODUCT_NAMESPACE');
    demand(
      value.source ===
        `urn:allblue:${target.productId}:${target.environment}:${target.instanceId}`,
      'EVENT_SOURCE_NAMESPACE',
    );
    demand(
      value.subject === `tenants/${target.tenantId}`,
      'EVENT_TENANT_NAMESPACE',
    );
    if (value.time)
      demand(
        time(value.time) <= time(value.observedat),
        'OCCURRENCE_AFTER_OBSERVATION',
      );
    const expectedKind = eventName.startsWith('tenant.')
      ? 'TENANT'
      : eventName.startsWith('subscription.')
        ? 'SUBSCRIPTION'
        : eventName === 'usage.metrics_recorded'
          ? 'USAGE'
          : eventName === 'billing.payment_succeeded'
            ? 'PAYMENT'
            : /adjustment|refund/.test(eventName)
              ? 'ADJUSTMENT'
              : 'INVOICE';
    demand(aggregate.kind === expectedKind, 'WRONG_AGGREGATE_KIND');
    if (aggregate.kind === 'TENANT')
      demand(aggregate.id === target.tenantId, 'WRONG_AGGREGATE_ID');
    const payloadId =
      aggregate.kind === 'SUBSCRIPTION'
        ? payload.subscriptionId
        : aggregate.kind === 'PAYMENT'
          ? payload.paymentId
          : aggregate.kind === 'INVOICE'
            ? payload.invoiceId
            : aggregate.kind === 'ADJUSTMENT'
              ? payload.adjustmentId
              : undefined;
    if (payloadId) demand(aggregate.id === payloadId, 'WRONG_AGGREGATE_ID');
    if (payload.billing)
      demand(
        payload.billing.mode ===
          (target.environment === 'production' ? 'LIVE' : 'TEST'),
        'BILLING_ENVIRONMENT_MISMATCH',
      );
    if (eventName === 'billing.payment_succeeded') {
      demand(payload.amountMinor > 0, 'PAYMENT_NOT_POSITIVE');
      demand(
        value.occurrencebasis === 'PROVIDER' &&
          value.time === payload.confirmedAt,
        'PAYMENT_OCCURRENCE_NOT_CORRELATED',
      );
      demand(
        value.data.provenance === 'PROVIDER_RECONCILIATION',
        'PAYMENT_EVIDENCE_SOURCE_REQUIRED',
      );
    }
    if (payload.completionOccurredAt)
      demand(
        time(payload.completionOccurredAt) <= time(value.observedat),
        'REFUND_COMPLETION_IN_FUTURE',
      );
    if (eventName.startsWith('subscription.') && payload.status)
      demand(payload.status !== 'UNKNOWN', 'UNKNOWN_IS_NOT_A_CONFIRMED_FACT');
  }
  if (name === 'command.schema.json') {
    if (value.precondition.aggregate === 'SUBSCRIPTION')
      demand(
        /^[1-9][0-9]*$/.test(value.precondition.version),
        'INVALID_SUBSCRIPTION_VERSION',
      );
    if (value.target.productId === 'orbit-v2' && value.parameters.planCode)
      demand(
        [
          'ESSENTIAL',
          'PROFESSIONAL',
          'PROFESSIONAL_INTELLIGENCE',
          'ENTERPRISE_UNLIMITED',
        ].includes(value.parameters.planCode),
        'UNKNOWN_ORBIT_PLAN',
      );
  }
  if (name === 'receipt.schema.json') {
    demand(
      value.confirmedBy === value.target.productId,
      'WRONG_CONFIRMING_PRODUCT',
    );
    demand(
      time(value.updatedAt) >= time(value.acceptedAt),
      'RECEIPT_TIME_REGRESSION',
    );
    if (value.processingStatus === 'SUCCEEDED')
      demand(
        machine.effectsByCommand[value.commandType].includes(value.effect.kind),
        'COMMAND_EFFECT_MISMATCH',
      );
    if (['APPLIED', 'UNCHANGED'].includes(value.effect.kind)) {
      const kind = value.commandType.startsWith('tenant.')
        ? 'TENANT'
        : 'SUBSCRIPTION';
      demand(value.effect.aggregate.kind === kind, 'WRONG_EFFECT_AGGREGATE');
      if (kind === 'TENANT')
        demand(
          value.effect.aggregate.id === value.target.tenantId,
          'WRONG_EFFECT_TENANT',
        );
    }
    if (value.effect.kind === 'PROVISIONED' && value.target.tenantId)
      demand(
        value.effect.tenantId === value.target.tenantId,
        'WRONG_PROVISIONED_TENANT',
      );
    if (value.effect.kind === 'SCHEDULED')
      demand(
        time(value.effect.effectiveAt) > time(value.updatedAt),
        'SCHEDULE_ALREADY_EFFECTIVE',
      );
    if (value.effect.kind === 'CANCELLATION_SCHEDULED')
      demand(
        time(value.effect.accessUntil) >= time(value.updatedAt),
        'PAID_PERIOD_SHORTENED',
      );
    if (['FAILED', 'REJECTED', 'EXPIRED'].includes(value.processingStatus))
      demand(
        value.error.code !== 'RECONCILIATION_REQUIRED',
        'UNKNOWN_OUTCOME_IS_NOT_TERMINAL',
      );
    if (value.commandType !== 'tenant.provision.v1')
      demand(Boolean(value.target.tenantId), 'TENANT_REQUIRED');
  }
  if (name === 'read.schema.json') {
    if (value.data.billing)
      demand(
        value.data.billing.mode ===
          (value.target.environment === 'production' ? 'LIVE' : 'TEST'),
        'BILLING_ENVIRONMENT_MISMATCH',
      );
    if (
      value.data.kind === 'SUBSCRIPTION' &&
      value.data.source === 'UNKNOWN_LEGACY'
    ) {
      demand(
        value.data.status === 'UNKNOWN' &&
          value.data.planCode === null &&
          value.data.subscriptionId === null &&
          value.data.subscriptionVersion === null &&
          value.data.pendingChange === null &&
          value.data.cancelAtPeriodEnd === false,
        'LEGACY_NOT_CANONICAL',
      );
      demand(
        [
          'billingInterval',
          'catalogVersion',
          'rightsVersion',
          'priceVersionRef',
          'currentPeriodEnd',
          'trialEndsAt',
        ].every((key) => value.data[key] === null),
        'LEGACY_FINANCIAL_STATE_UNKNOWN',
      );
    }
    if (value.data.kind === 'SUBSCRIPTION' && value.data.source === 'CANONICAL')
      demand(
        value.data.status !== 'UNKNOWN' &&
          value.data.subscriptionId !== null &&
          value.data.subscriptionVersion !== null,
        'CANONICAL_REFERENCE_REQUIRED',
      );
  }
  const metric =
    name === 'event.schema.json' &&
    value.type.endsWith('.usage.metrics_recorded.v1')
      ? value.data.payload
      : name === 'read.schema.json'
        ? value.data.metric
        : undefined;
  if (metric) {
    demand(
      time(metric.window.from) < time(metric.window.until),
      'INVALID_METRIC_WINDOW',
    );
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: metric.window.timeZone });
    } catch {
      errors.push('INVALID_METRIC_TIMEZONE');
    }
  }
  if (name === 'directory.schema.json') {
    const keys = value.items.map(({ target: t }) =>
      [t.productId, t.environment, t.instanceId, t.tenantId].join('/'),
    );
    demand(new Set(keys).size === keys.length, 'DUPLICATE_DIRECTORY_TENANT');
  }
  if (name === 'event-page.schema.json') {
    for (const event of value.events)
      errors.push(...semanticErrors('event.schema.json', event));
  }
  return errors;
}

function validateContract(name, value) {
  const validator = validators[name];
  if (!validator) throw new Error(`Unknown contract: ${name}`);
  if (!validator(value))
    return { valid: false, errors: copy(validator.errors) };
  const errors = semanticErrors(name, value);
  return { valid: errors.length === 0, errors };
}

/** Checks a documented transition, not an executor/inbox implementation. */
function validateTransition(before, after) {
  if (
    !validateContract('receipt.schema.json', before).valid ||
    !validateContract('receipt.schema.json', after).valid
  )
    return false;
  const immutable = [
    'commandId',
    'receiptId',
    'commandType',
    'target',
    'acceptedAt',
    'correlationId',
    'confirmedBy',
  ];
  return (
    immutable.every((key) => isDeepStrictEqual(before[key], after[key])) &&
    after.receiptVersion > before.receiptVersion &&
    Date.parse(after.updatedAt) >= Date.parse(before.updatedAt) &&
    machine.transitions[before.processingStatus].includes(
      after.processingStatus,
    )
  );
}

module.exports = {
  root,
  catalog,
  machine,
  validateContract,
  validateTransition,
};
