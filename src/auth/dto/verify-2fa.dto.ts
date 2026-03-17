import { IsString, IsNotEmpty, Length } from 'class-validator';

export class Verify2FADto {
  @IsString()
  @IsNotEmpty()
  tempToken!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'TOTP code must be 6 digits' })
  totpCode!: string;

  @IsString()
  @IsNotEmpty()
  fingerprint!: string;
}
