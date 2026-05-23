import { IsString, IsOptional, IsBoolean, Matches, ValidateNested, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateOwnerDto } from '../../owners/dto/index.js';

export class CreateVehicleDto {
  @IsString()
  talonNumber!: string;

  @IsString()
  @Matches(/^(?:[A-ZА-Я]{1,2}\d{4}[A-ZА-Я]{1,2}|[A-ZА-Я]{2}\d{3,7})$/i, {
    message: 'Невалиден регистрационен номер (пример: СА1234АВ — кола, СА1234А — мотор, СА12345 — трактор)',
  })
  registrationNumber!: string;

  @IsString()
  engineCapacity!: string;

  @IsString()
  powerKW!: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsBoolean()
  rightHandDrive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  // Owner can be provided as existing ID or new owner data
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOwnerDto)
  owner?: CreateOwnerDto;
}
