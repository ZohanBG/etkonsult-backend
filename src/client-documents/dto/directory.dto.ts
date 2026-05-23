import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateDirectoryDto {
  @IsString()
  @MinLength(1, { message: 'Името на директорията е задължително' })
  @MaxLength(120, { message: 'Името на директорията е твърде дълго' })
  name!: string;
}

export class UpdateDirectoryDto {
  @IsString()
  @MinLength(1, { message: 'Името на директорията е задължително' })
  @MaxLength(120, { message: 'Името на директорията е твърде дълго' })
  name!: string;
}
