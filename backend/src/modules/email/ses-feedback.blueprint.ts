/**
 * FUTURE: POST /webhooks/aws/ses (not registered or publicly exposed).
 *
 * 1. Accept SNS's text/plain JSON envelope with a strict body-size limit.
 *    Validate its shape without logging Message, headers or recipient data.
 * 2. Verify the SNS signature BEFORE processing either Notification or
 *    SubscriptionConfirmation. Validate the signing certificate's trusted
 *    HTTPS SNS hostname, path and certificate chain; forbid redirects and
 *    arbitrary certificate/SubscribeURL fetches (SSRF). Prefer signature v2.
 * 3. Require an explicitly configured TopicArn (account + region + topic).
 *    Reject unexpected topics even when their signature is valid.
 * 4. Confirm subscriptions only after those checks, through the SNS SDK and
 *    the validated TopicArn/Token. Never blindly GET the supplied SubscribeURL.
 * 5. Parse the verified inner SES message. Validate sendingAccountId/sourceArn
 *    against this deployment and link mail.messageId to an actual outbound
 *    delivery. The HTTP body never determines the organization/database scope.
 * 6. In one transaction: claim unique (TopicArn, MessageId), persist the event,
 *    and suppress the normalized known recipient on Permanent bounce or
 *    Complaint. Add email_delivery_status/email_suppressed_at (or a dedicated
 *    suppression table), and make EmailService consult it before future sends.
 *    Never mark a temporary bounce permanently invalid, disable a login or
 *    delete tenant data. Handle all bouncedRecipients/complainedRecipients.
 * 7. Return 2xx only after persistence; duplicates return 2xx without repeating
 *    effects. Database/transient failures return 5xx for SNS retry. Record only
 *    safe event codes and opaque provider IDs; never log the original payload.
 *
 * https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 * https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html
 */
export interface VerifiedSesFeedback {
  topicArn: string;
  snsMessageId: string;
  sesMessageId: string;
  kind: 'PERMANENT_BOUNCE' | 'COMPLAINT' | 'TEMPORARY_BOUNCE';
  recipients: readonly string[];
}

/** Blueprint only. A future implementation must supply both security and persistence. */
export abstract class SesFeedbackWebhookBlueprint {
  abstract authenticateAndParse(
    rawEnvelope: unknown,
  ): Promise<VerifiedSesFeedback>;
  abstract persistAndSuppressAtomically(
    feedback: VerifiedSesFeedback,
  ): Promise<void>;
}
