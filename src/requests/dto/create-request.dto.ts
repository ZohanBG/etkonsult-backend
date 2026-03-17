import { IsString, IsOptional, IsBoolean, IsEnum, IsArray, IsInt, ValidateIf } from 'class-validator';
import { RequestType } from '@prisma/client';

export class CreateRequestDto {
  @IsOptional()
  @IsEnum(RequestType)
  requestType?: RequestType;

  // Required for NOVA_POLICA only
  @ValidateIf((o) => o.requestType !== 'VNOSKA')
  @IsString()
  talonNumber?: string;

  // Required for NOVA_POLICA, optional for VNOSKA (can use insuranceNumber instead)
  @ValidateIf((o) => o.requestType !== 'VNOSKA')
  @IsString()
  registrationNumber?: string;

  // Required for NOVA_POLICA only
  @ValidateIf((o) => o.requestType !== 'VNOSKA')
  @IsString()
  engineCapacity?: string;

  @ValidateIf((o) => o.requestType !== 'VNOSKA')
  @IsString()
  powerKW?: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsBoolean()
  rightHandDrive?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  installments?: number[];

  @IsOptional()
  @IsString()
  ownerIdentifier?: string;

  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsString()
  ownerAddress?: string;

  @IsOptional()
  @IsString()
  ownerPhone?: string;

  @IsOptional()
  @IsString()
  ownerEmail?: string;

  // VNOSKA-specific fields (sticker/greenCard at creation)
  @IsOptional()
  @IsString()
  stickerNumber?: string;

  @IsOptional()
  @IsString()
  greenCardNumber?: string;

  @IsOptional()
  @IsString()
  insuranceNumber?: string;

  @IsOptional()
  @IsString()
  agentNote?: string;
}
