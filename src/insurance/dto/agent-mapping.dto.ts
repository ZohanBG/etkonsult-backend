import { IsString, IsUUID, MinLength, IsArray } from 'class-validator';

export class CreateAgentMappingDto {
  @IsString()
  @MinLength(1)
  agentName!: string;

  @IsUUID()
  userId!: string;
}

export class BulkAgentMappingDto {
  @IsUUID()
  userId!: string;

  @IsArray()
  @IsString({ each: true })
  agentNames!: string[];
}
