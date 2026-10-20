import { Injectable } from '@nestjs/common';

@Injectable()
export class MobilePushMetrics {
  private attempted = 0;
  private accepted = 0;
  private invalidTokens = 0;
  private temporaryFailures = 0;
  private permanentFailures = 0;

  record(result: string): void {
    this.attempted++;
    if (result === 'ACCEPTED_BY_PROVIDER') this.accepted++;
    else if (result === 'INVALID_TOKEN') this.invalidTokens++;
    else if (result === 'TEMPORARY_FAILURE') this.temporaryFailures++;
    else if (result === 'PERMANENT_FAILURE') this.permanentFailures++;
  }

  snapshot() {
    return {
      attempted: this.attempted,
      acceptedByProvider: this.accepted,
      invalidTokens: this.invalidTokens,
      temporaryFailures: this.temporaryFailures,
      permanentFailures: this.permanentFailures,
    };
  }
}
