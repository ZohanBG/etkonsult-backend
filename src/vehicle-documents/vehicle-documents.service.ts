import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpsertVehicleDocumentDto } from './dto/index.js';

export type DocKind = 'GTP' | 'VIGNETTE';

@Injectable()
export class VehicleDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  private validateDates(dto: UpsertVehicleDocumentDto): { from: Date; to: Date } {
    const from = new Date(dto.validFrom);
    const to = new Date(dto.validTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Невалидни дати');
    }
    if (to <= from) {
      throw new BadRequestException('Крайната дата трябва да е след началната');
    }
    return { from, to };
  }

  async listByRegistrationNumber(kind: DocKind, registrationNumber: string) {
    const reg = registrationNumber.trim().toUpperCase();
    if (kind === 'GTP') {
      return this.prisma.technicalInspection.findMany({
        where: { registrationNumber: reg },
        orderBy: { validTo: 'desc' },
      });
    }
    return this.prisma.vignette.findMany({
      where: { registrationNumber: reg },
      orderBy: { validTo: 'desc' },
    });
  }

  async create(kind: DocKind, dto: UpsertVehicleDocumentDto, userId: string) {
    const { from, to } = this.validateDates(dto);
    const data = {
      registrationNumber: dto.registrationNumber.trim().toUpperCase(),
      validFrom: from,
      validTo: to,
      notes: dto.notes?.trim() || null,
      createdById: userId,
    };
    if (kind === 'GTP') {
      return this.prisma.technicalInspection.create({ data });
    }
    return this.prisma.vignette.create({ data });
  }

  async update(kind: DocKind, id: string, dto: UpsertVehicleDocumentDto) {
    const { from, to } = this.validateDates(dto);
    const data = {
      registrationNumber: dto.registrationNumber.trim().toUpperCase(),
      validFrom: from,
      validTo: to,
      notes: dto.notes?.trim() || null,
    };
    try {
      if (kind === 'GTP') {
        return await this.prisma.technicalInspection.update({ where: { id }, data });
      }
      return await this.prisma.vignette.update({ where: { id }, data });
    } catch {
      throw new NotFoundException('Записът не е намерен');
    }
  }

  async delete(kind: DocKind, id: string) {
    try {
      if (kind === 'GTP') {
        await this.prisma.technicalInspection.delete({ where: { id } });
      } else {
        await this.prisma.vignette.delete({ where: { id } });
      }
    } catch {
      throw new NotFoundException('Записът не е намерен');
    }
  }
}
