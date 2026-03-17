import { IsString, IsEnum, IsOptional } from 'class-validator';
import { RequestStatus } from '@prisma/client';

export class UpdateRequestStatusDto {
  @IsEnum(RequestStatus)
  status!: RequestStatus;

  @IsOptional()
  @IsString()
  cancellationNote?: string;
}

export class CancelRequestDto {
  @IsOptional()
  @IsString()
  cancellationNote?: string;
}

export class RespondOfferDto {
  @IsEnum(RequestStatus)
  status!: RequestStatus;

  @IsOptional()
  @IsString()
  stickerNumber?: string;

  @IsOptional()
  @IsString()
  greenCardNumber?: string;

  @IsOptional()
  @IsString()
  offerNote?: string;
}
