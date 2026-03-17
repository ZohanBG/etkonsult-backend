import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsArray,
  MinLength,
  IsEnum,
} from 'class-validator';
import { UserStatus } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roleIds?: string[];
}

export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  @MinLength(8)
  password?: string;

  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roleIds?: string[];
}

export class UserQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @IsString()
  @IsOptional()
  page?: string;

  @IsString()
  @IsOptional()
  limit?: string;
}
