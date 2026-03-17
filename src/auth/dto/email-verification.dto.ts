import { IsString, IsNotEmpty, Length } from 'class-validator';

export class SendVerificationDto {
  @IsString()
  @IsNotEmpty()
  tempToken!: string;

  @IsString()
  @IsNotEmpty()
  fingerprint!: string;
}

export class VerifyEmailCodeDto {
  @IsString()
  @IsNotEmpty()
  tempToken!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @IsString()
  @IsNotEmpty()
  fingerprint!: string;
}
