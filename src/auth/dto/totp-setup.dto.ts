import { IsString, IsNotEmpty, Length } from 'class-validator';

export class TotpVerifyDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'TOTP code must be 6 digits' })
  token!: string;
}

export class TotpSetupResponseDto {
  secret!: string;
  qrCodeUrl!: string;
  otpauthUrl!: string;
}
