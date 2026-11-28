import { SetMetadata } from '@nestjs/common';

export const PLATFORM_MFA_SETUP = 'identity:platform-mfa-setup';

/** Permits this self-service route on the authenticated client surface during enrollment. */
export const PlatformMfaSetup = () => SetMetadata(PLATFORM_MFA_SETUP, true);
