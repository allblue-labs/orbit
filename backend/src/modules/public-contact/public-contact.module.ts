import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { PublicContactController } from './public-contact.controller';
import { PublicContactRepository } from './public-contact.repository';
import { PublicContactWorker } from './public-contact.worker';
@Module({
  imports: [EmailModule],
  controllers: [PublicContactController],
  providers: [PublicContactRepository, PublicContactWorker],
})
export class PublicContactModule {}
