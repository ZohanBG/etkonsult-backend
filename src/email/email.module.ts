import { Module, Global } from '@nestjs/common';
import { EmailService } from './email.service.js';

@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
