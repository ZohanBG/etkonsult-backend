import { IsInt, IsString, Min, Max, MinLength } from 'class-validator';

export class CreateSpreadsheetDto {
  @IsInt()
  @Min(2020)
  @Max(2050)
  year!: number;

  @IsString()
  @MinLength(5)
  spreadsheetId!: string; // Can be full URL or just the ID

  @IsString()
  @MinLength(1)
  label!: string;
}

export class ValidateSpreadsheetDto {
  @IsString()
  @MinLength(5)
  spreadsheetId!: string; // Can be full URL or just the ID
}
