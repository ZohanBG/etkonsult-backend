import { IsString, IsOptional, IsEmail } from 'class-validator';

export class CreateOwnerDto {
  @IsString()
  identifier!: string; // ЕГН/ЕИК/ЛНЧ

  @IsString()
  name!: string;

  @IsString()
  address!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Невалиден имейл адрес' })
  email?: string;
}
