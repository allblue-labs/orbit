import { OutboundModule } from '../../network/outbound.module';
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiController } from './ai.controller';
import { AiProviderRegistry, OpenAiCompatibleProvider } from './ai-provider';
import { AiRepository } from './ai.repository';
import { AiService } from './ai.service';

@Module({
  imports: [OutboundModule, NotificationsModule],
  controllers: [AiController],
  providers: [
    AiRepository,
    AiService,
    AiProviderRegistry,
    OpenAiCompatibleProvider,
  ],
  exports: [AiService],
})
export class AiPanelModule {}
