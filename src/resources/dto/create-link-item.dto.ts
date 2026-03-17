import { IsString, IsNotEmpty, IsOptional, IsUrl, IsInt, Min } from 'class-validator';

export class CreateLinkItemDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl()
  url!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
