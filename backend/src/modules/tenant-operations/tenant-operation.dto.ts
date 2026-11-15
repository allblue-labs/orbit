import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn } from 'class-validator';
export class ChangeTenantOperationDto {
  @ApiProperty({
    enum: ['ACTIVE', 'SUSPENDED'],
    description:
      'Estado operacional imediato; não altera assinatura ou direitos financeiros.',
  })
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';
  @ApiProperty({ enum: ['SECURITY', 'ABUSE', 'ADMINISTRATIVE', 'RESOLVED'] })
  @IsIn(['SECURITY', 'ABUSE', 'ADMINISTRATIVE', 'RESOLVED'])
  reason!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'updatedAt atual da organização, usado como precondição de concorrência.',
  })
  @Type(() => Date)
  @IsDate()
  expectedUpdatedAt!: Date;
}
