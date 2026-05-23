import { IsString, IsOptional, IsISO8601, MaxLength } from 'class-validator';

export class UpsertVehicleDocumentDto {
  @IsString()
  registrationNumber!: string;

  @IsISO8601()
  validFrom!: string;

  @IsISO8601()
  validTo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
