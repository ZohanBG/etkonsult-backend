import { IsString, IsNotEmpty, IsOptional, IsUrl, IsInt, Min } from 'class-validator';

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  url?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
