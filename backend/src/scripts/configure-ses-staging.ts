import {
  CreateTopicCommand,
  GetTopicAttributesCommand,
  SetTopicAttributesCommand,
  SNSClient,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  UpdateConfigurationSetEventDestinationCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { emailConfiguration } from '../modules/email/email.config';
import {
  resolveSesIdentity,
  validateSesConfiguration,
} from '../modules/email/ses-preflight';
/** Operator-only, explicit apply. Touches only named Orbit staging resources. No emails. */
async function main() {
  const config = emailConfiguration();
  validateSesConfiguration(config);
  const name = 'orbit-feedback-staging',
    endpoint = 'https://orbit.allblue-labs.com/api/v1/email/webhooks/ses-sns';
  if (!process.argv.includes('--apply')) {
    console.log(
      JSON.stringify({
        stage: 'ses-staging-plan',
        region: config.region,
        topic: name,
        configurationSet: name,
        endpoint,
        changes: false,
      }),
    );
    return;
  }
  const credentials = {
    accessKeyId: config.accessKeyId!,
    secretAccessKey: config.secretAccessKey!,
    sessionToken: config.sessionToken,
  };
  const sns = new SNSClient({
      region: config.region,
      credentials,
      maxAttempts: 2,
    }),
    ses = new SESv2Client({
      region: config.region,
      credentials,
      maxAttempts: 2,
    });
  const sendOptions = { abortSignal: AbortSignal.timeout(15000) };
  try {
    const identity = await resolveSesIdentity(ses, config);
    if (!identity?.details.VerifiedForSendingStatus)
      throw new Error('SES_IDENTITY_NOT_VERIFIED');
    const created = await sns.send(
      new CreateTopicCommand({
        Name: name,
        Attributes: { SignatureVersion: '2' },
        Tags: [
          { Key: 'application', Value: 'orbit' },
          { Key: 'environment', Value: 'staging' },
        ],
      }),
      sendOptions,
    );
    const arn = created.TopicArn!;
    const parts = arn.split(':');
    const account = parts[4];
    if (
      !account ||
      !/^\d{12}$/.test(account) ||
      arn !== `arn:aws:sns:${config.region}:${account}:${name}`
    )
      throw new Error('SNS_TOPIC_BINDING_INVALID');
    await sns.send(
      new SetTopicAttributesCommand({
        TopicArn: arn,
        AttributeName: 'SignatureVersion',
        AttributeValue: '2',
      }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
    const existing = await sns.send(
      new GetTopicAttributesCommand({ TopicArn: arn }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
    const policy = JSON.parse(
      existing.Attributes?.Policy ?? '{"Version":"2012-10-17","Statement":[]}',
    ) as { Version: string; Statement: Record<string, unknown>[] };
    policy.Statement = policy.Statement.filter(
      (s) => s.Sid !== 'OrbitSesStagingPublish',
    );
    policy.Statement.push({
      Sid: 'OrbitSesStagingPublish',
      Effect: 'Allow',
      Principal: { Service: 'ses.amazonaws.com' },
      Action: 'sns:Publish',
      Resource: arn,
      Condition: {
        StringEquals: {
          'AWS:SourceAccount': account,
          'AWS:SourceArn': `arn:aws:ses:${config.region}:${account}:configuration-set/${name}`,
        },
      },
    });
    await sns.send(
      new SetTopicAttributesCommand({
        TopicArn: arn,
        AttributeName: 'Policy',
        AttributeValue: JSON.stringify(policy),
      }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
    try {
      await ses.send(
        new CreateConfigurationSetCommand({
          ConfigurationSetName: name,
          VdmOptions: { DashboardOptions: { EngagementMetrics: 'DISABLED' } },
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AlreadyExistsException')) throw e;
    }
    const destination = {
      Enabled: true,
      MatchingEventTypes: [
        'SEND',
        'DELIVERY',
        'BOUNCE',
        'COMPLAINT',
        'REJECT',
      ] as ('SEND' | 'DELIVERY' | 'BOUNCE' | 'COMPLAINT' | 'REJECT')[],
      SnsDestination: { TopicArn: arn },
    };
    try {
      await ses.send(
        new CreateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: name,
          EventDestinationName: 'orbit-sns',
          EventDestination: destination,
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AlreadyExistsException')) throw e;
      await ses.send(
        new UpdateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: name,
          EventDestinationName: 'orbit-sns',
          EventDestination: destination,
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
    }
    if (process.argv.includes('--subscribe'))
      await sns.send(
        new SubscribeCommand({
          TopicArn: arn,
          Protocol: 'https',
          Endpoint: endpoint,
          ReturnSubscriptionArn: true,
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
    console.log(
      JSON.stringify({
        stage: 'ses-staging-configured',
        region: config.region,
        accountId: account,
        topicArn: arn,
        configurationSet: name,
        identityArn: `arn:aws:ses:${config.region}:${account}:identity/${identity.name}`,
        subscriptionRequested: process.argv.includes('--subscribe'),
      }),
    );
  } finally {
    sns.destroy();
    ses.destroy();
  }
}
void main().catch((error) => {
  console.error(
    JSON.stringify({
      stage: 'ses-staging-configuration-failed',
      code: error instanceof Error ? error.name : 'AWS_CONFIGURATION_FAILED',
    }),
  );
  process.exitCode = 1;
});
