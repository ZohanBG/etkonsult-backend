import { IsOptional, IsString, IsIn } from 'class-validator';

export type ExpiryStatus = 'all' | 'expired' | 'recently_expired' | 'expiring_soon' | 'active' | 'unknown';

export class ExpiryFilterDto {
  @IsOptional()
  @IsString()
  @IsIn(['all', 'expired', 'recently_expired', 'expiring_soon', 'active', 'unknown'])
  status?: ExpiryStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  agentName?: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  policyNumber?: string;

  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
