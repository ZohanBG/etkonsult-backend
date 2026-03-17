import { PartialType } from '@nestjs/mapped-types';
import { CreateOwnerDto } from './create-owner.dto.js';

export class UpdateOwnerDto extends PartialType(CreateOwnerDto) {}
