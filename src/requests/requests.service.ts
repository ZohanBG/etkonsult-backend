import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { RequestImageType, RequestStatus, RequestType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { RespondOfferDto } from './dto/update-request-status.dto.js';
import type { ProcessedImage } from '../uploads/uploads.service.js';
import * as path from 'path';
import * as fs from 'fs/promises';

// State machine: valid transitions for NOVA_POLICA
const NOVA_POLICA_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.ZAYAVENA]: [RequestStatus.OBRABOTENA, RequestStatus.OTKAZANA],
  [RequestStatus.OBRABOTENA]: [RequestStatus.PRIETA_OFERTA, RequestStatus.OTKAZANA_OFERTA, RequestStatus.OTKAZANA],
  [RequestStatus.OTKAZANA]: [],
  [RequestStatus.OTKAZANA_OT_AGENT]: [],
  [RequestStatus.PRIETA_OFERTA]: [RequestStatus.ZAVURSHENA, RequestStatus.OTKAZANA],
  [RequestStatus.OTKAZANA_OFERTA]: [],
  [RequestStatus.ZAVURSHENA]: [],
};

// State machine: valid transitions for VNOSKA (simplified — no offer step)
const VNOSKA_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.ZAYAVENA]: [RequestStatus.ZAVURSHENA, RequestStatus.OTKAZANA],
  [RequestStatus.OBRABOTENA]: [],
  [RequestStatus.OTKAZANA]: [],
  [RequestStatus.OTKAZANA_OT_AGENT]: [],
  [RequestStatus.PRIETA_OFERTA]: [],
  [RequestStatus.OTKAZANA_OFERTA]: [],
  [RequestStatus.ZAVURSHENA]: [],
};

function getValidTransitions(requestType: RequestType, currentStatus: RequestStatus): RequestStatus[] {
  const transitions = requestType === RequestType.VNOSKA
    ? VNOSKA_TRANSITIONS
    : NOVA_POLICA_TRANSITIONS;
  return transitions[currentStatus];
}

// Bulgarian labels for statuses
export const STATUS_LABELS: Record<RequestStatus, string> = {
  [RequestStatus.ZAYAVENA]: 'Заявена',
  [RequestStatus.OBRABOTENA]: 'Обработена',
  [RequestStatus.OTKAZANA]: 'Отказана',
  [RequestStatus.OTKAZANA_OT_AGENT]: 'Отказана от агент',
  [RequestStatus.PRIETA_OFERTA]: 'Приета оферта',
  [RequestStatus.OTKAZANA_OFERTA]: 'Отказана оферта',
  [RequestStatus.ZAVURSHENA]: 'Завършена',
};

const requestInclude = {
  agent: {
    select: { id: true, email: true, username: true },
  },
  processedBy: {
    select: { id: true, email: true, username: true },
  },
  images: {
    orderBy: { uploadedAt: 'asc' as const },
  },
};

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRequestDto, agentId: string) {
    const requestType = dto.requestType || RequestType.NOVA_POLICA;

    // VNOSKA-specific validation
    if (requestType === RequestType.VNOSKA) {
      const hasInsurance = !!dto.insuranceNumber?.trim();
      const hasRegAndTalon = !!dto.registrationNumber?.trim() && !!dto.talonNumber?.trim();
      if (!hasInsurance && !hasRegAndTalon) {
        throw new BadRequestException('Необходим е номер на застраховка или рег. номер + талон №');
      }
    }

    return this.prisma.request.create({
      data: {
        requestType,
        registrationNumber: (dto.registrationNumber ?? '').toUpperCase(),
        talonNumber: dto.talonNumber || null,
        engineCapacity: dto.engineCapacity || null,
        powerKW: dto.powerKW || null,
        purpose: dto.purpose,
        rightHandDrive: dto.rightHandDrive,
        ownerIdentifier: dto.ownerIdentifier,
        ownerName: dto.ownerName,
        ownerAddress: dto.ownerAddress,
        ownerPhone: dto.ownerPhone,
        ownerEmail: dto.ownerEmail,
        stickerNumber: dto.stickerNumber?.trim() || null,
        greenCardNumber: dto.greenCardNumber?.trim() || null,
        insuranceNumber: dto.insuranceNumber?.trim() || null,
        installments: dto.installments ?? [],
        agentNote: dto.agentNote?.trim() || null,
        agentId,
      },
      include: requestInclude,
    });
  }

  private buildDateFilter(dateFrom?: string, dateTo?: string): { gte?: Date; lte?: Date } | undefined {
    if (!dateFrom && !dateTo) return undefined;
    const filter: { gte?: Date; lte?: Date } = {};
    if (dateFrom) filter.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.lte = end;
    }
    return filter;
  }

  private async paginatedQuery(where: Record<string, unknown>, page: number, limit: number) {
    const [items, total] = await Promise.all([
      this.prisma.request.findMany({
        where,
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.request.count({ where }),
    ]);
    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findAll(
    page = 1,
    limit = 20,
    status?: RequestStatus,
    requestType?: RequestType,
    agentId?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (requestType) where.requestType = requestType;
    if (agentId) where.agentId = agentId;
    const dateFilter = this.buildDateFilter(dateFrom, dateTo);
    if (dateFilter) where.createdAt = dateFilter;

    return this.paginatedQuery(where, page, limit);
  }

  async findMyRequests(agentId: string, page = 1, limit = 20, status?: RequestStatus, requestType?: RequestType, dateFrom?: string, dateTo?: string) {
    const where: Record<string, unknown> = { agentId };
    if (status) where.status = status;
    if (requestType) where.requestType = requestType;
    const dateFilter = this.buildDateFilter(dateFrom, dateTo);
    if (dateFilter) where.createdAt = dateFilter;

    return this.paginatedQuery(where, page, limit);
  }

  /**
   * For a batch of registration numbers, return the most recent non-cancelled
   * request per reg number (if any). Used by the insurance page to decide
   * whether to disable the "Заяви" button.
   */
  async checkActiveByRegs(
    registrationNumbers: string[],
  ): Promise<Record<string, { status: string; createdAt: string }>> {
    if (registrationNumbers.length === 0) return {};

    const normalised = registrationNumbers.map((r) => r.toUpperCase());

    // Fetch most recent non-cancelled request per reg number
    // We order by createdAt desc and take 1 per reg, done in JS grouping
    const requests = await this.prisma.request.findMany({
      where: {
        registrationNumber: { in: normalised },
        status: {
          notIn: [RequestStatus.OTKAZANA, RequestStatus.OTKAZANA_OT_AGENT, RequestStatus.OTKAZANA_OFERTA],
        },
      },
      select: {
        registrationNumber: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Keep only the latest per reg number
    const result: Record<string, { status: string; createdAt: string }> = {};
    for (const req of requests) {
      if (!result[req.registrationNumber]) {
        result[req.registrationNumber] = {
          status: req.status,
          createdAt: req.createdAt.toISOString(),
        };
      }
    }
    return result;
  }

  async findOne(id: string) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: requestInclude,
    });

    if (!request) {
      throw new NotFoundException('Заявката не е намерена');
    }

    return request;
  }

  async updateStatus(id: string, newStatus: RequestStatus, userId: string, cancellationNote?: string) {
    const request = await this.findOne(id);

    // Validate state transition using type-aware state machine
    const validNextStatuses = getValidTransitions(request.requestType, request.status);
    if (!validNextStatuses.includes(newStatus)) {
      throw new BadRequestException(
        `Невалиден преход: от "${STATUS_LABELS[request.status]}" към "${STATUS_LABELS[newStatus]}"`,
      );
    }

    const updateData: Record<string, unknown> = {
      status: newStatus,
      processedById: userId,
    };

    if (newStatus === RequestStatus.OTKAZANA && cancellationNote?.trim()) {
      updateData.cancellationNote = cancellationNote.trim();
    }

    return this.prisma.request.update({
      where: { id },
      data: updateData,
      include: requestInclude,
    });
  }

  /**
   * Agent cancels their own request — only allowed from ZAYAVENA status.
   */
  async cancelOwnRequest(id: string, agentId: string, cancellationNote?: string) {
    const request = await this.findOne(id);

    if (request.agentId !== agentId) {
      throw new ForbiddenException('Само агентът, създал заявката, може да я откаже');
    }

    if (request.status !== RequestStatus.ZAYAVENA) {
      throw new BadRequestException('Заявката може да се откаже само в статус "Заявена"');
    }

    const updateData: Record<string, unknown> = { status: RequestStatus.OTKAZANA_OT_AGENT };
    if (cancellationNote?.trim()) {
      updateData.cancellationNote = cancellationNote.trim();
    }

    return this.prisma.request.update({
      where: { id },
      data: updateData,
      include: requestInclude,
    });
  }

  async respondToOffer(id: string, dto: RespondOfferDto, agentId: string) {
    const request = await this.findOne(id);

    // Only the agent who created the request can respond
    if (request.agentId !== agentId) {
      throw new ForbiddenException('Само агентът, създал заявката, може да отговори на офертата');
    }

    // Must be in OBRABOTENA status (staff has uploaded offer photos)
    if (request.status !== RequestStatus.OBRABOTENA) {
      throw new BadRequestException('Заявката не е в статус "Обработена"');
    }

    // Validate transition
    if (dto.status !== RequestStatus.PRIETA_OFERTA && dto.status !== RequestStatus.OTKAZANA_OFERTA) {
      throw new BadRequestException('Невалиден статус. Очаква се "Приета оферта" или "Отказана оферта"');
    }

    const updateData: Record<string, unknown> = { status: dto.status };

    if (dto.status === RequestStatus.PRIETA_OFERTA) {
      if (dto.stickerNumber?.trim()) {
        updateData.stickerNumber = dto.stickerNumber.trim();
      }
      if (dto.greenCardNumber?.trim()) {
        updateData.greenCardNumber = dto.greenCardNumber.trim();
      }
      if (dto.offerNote?.trim()) {
        updateData.offerNote = dto.offerNote.trim();
      }
    }

    return this.prisma.request.update({
      where: { id },
      data: updateData,
      include: requestInclude,
    });
  }

  async getRequestImageCount(requestId: string, imageType?: RequestImageType): Promise<number> {
    const where: { requestId: string; imageType?: RequestImageType } = { requestId };
    if (imageType) where.imageType = imageType;
    return this.prisma.requestImage.count({ where });
  }

  async saveRequestImages(
    requestId: string,
    images: ProcessedImage[],
    imageType: RequestImageType,
  ): Promise<void> {
    if (images.length === 0) return;

    await this.prisma.requestImage.createMany({
      data: images.map((image) => ({
        requestId,
        path: image.path,
        originalName: image.originalName,
        mimeType: image.mimeType,
        size: image.size,
        imageType,
      })),
    });
  }

  async deleteRequestImage(imageId: string): Promise<void> {
    const image = await this.prisma.requestImage.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    // Delete from DB first to avoid orphaned records if DB delete fails
    await this.prisma.requestImage.delete({ where: { id: imageId } });

    // Then clean up the physical file (with path traversal protection)
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    const filePath = path.resolve(process.cwd(), 'uploads', image.path);
    if (!filePath.startsWith(uploadsRoot + path.sep)) {
      throw new BadRequestException('Invalid file path');
    }
    try {
      await fs.unlink(filePath);
    } catch {
      // File might not exist on disk, that's ok
    }
  }

  /**
   * Copy request photo images to the matching vehicle (looked up by registrationNumber).
   * Returns an error string or null on success.
   */
  async copyPhotosToVehicle(
    requestId: string,
  ): Promise<{ copiedCount: number }> {
    const request = await this.findOne(requestId);

    // Find vehicle by registrationNumber
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { registrationNumber: request.registrationNumber },
    });

    if (!vehicle) {
      throw new BadRequestException(
        `МПС с рег. номер "${request.registrationNumber}" не е намерено в системата`,
      );
    }

    // Get photo images from request
    const photoImages = request.images.filter(
      (img) => img.imageType === RequestImageType.photo,
    );

    if (photoImages.length === 0) {
      throw new BadRequestException('Заявката няма снимки за копиране');
    }

    // Filter out photos already linked to this vehicle (prevent duplicates)
    const existingVehicleImagePaths = await this.prisma.vehicleImage.findMany({
      where: { vehicleId: vehicle.id },
      select: { path: true },
    });
    const existingPathSet = new Set(existingVehicleImagePaths.map((i) => i.path));
    const newPhotos = photoImages.filter((img) => !existingPathSet.has(img.path));

    if (newPhotos.length === 0) {
      throw new BadRequestException('Снимките от тази заявка вече са добавени към МПС-то');
    }

    // Check vehicle capacity
    const existingCount = existingVehicleImagePaths.length;
    if (existingCount + newPhotos.length > 10) {
      const available = 10 - existingCount;
      throw new BadRequestException(
        `МПС-то вече има ${existingCount} снимки. Може да се добавят още ${available}, но заявката има ${newPhotos.length} нови снимки. Максимум: 10.`,
      );
    }

    // Copy images — create VehicleImage records reusing the same file paths
    await this.prisma.vehicleImage.createMany({
      data: newPhotos.map((img) => ({
        vehicleId: vehicle.id,
        path: img.path,
        originalName: img.originalName,
        mimeType: img.mimeType,
        size: img.size,
      })),
    });

    return { copiedCount: newPhotos.length };
  }

  /**
   * Check if all photo images from a request have already been copied to the matching vehicle.
   */
  async getCopyToVehicleStatus(requestId: string): Promise<{ alreadyCopied: boolean }> {
    const request = await this.findOne(requestId);

    const vehicle = await this.prisma.vehicle.findFirst({
      where: { registrationNumber: request.registrationNumber },
    });

    if (!vehicle) return { alreadyCopied: false };

    const photoImages = request.images.filter(
      (img) => img.imageType === RequestImageType.photo,
    );

    if (photoImages.length === 0) return { alreadyCopied: false };

    const existingPaths = await this.prisma.vehicleImage.findMany({
      where: { vehicleId: vehicle.id },
      select: { path: true },
    });

    const existingPathSet = new Set(existingPaths.map((i) => i.path));
    const allCopied = photoImages.every((img) => existingPathSet.has(img.path));

    return { alreadyCopied: allCopied };
  }
}
