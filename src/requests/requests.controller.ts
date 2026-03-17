import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RequestImageType, RequestStatus, RequestType } from '@prisma/client';
import { RequestsService } from './requests.service.js';
import { RequestsEventsService } from './requests-events.service.js';
import { CreateRequestDto, UpdateRequestStatusDto, RespondOfferDto, CancelRequestDto } from './dto/index.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator.js';
import { AuditInterceptor, Audit } from '../audit/audit.interceptor.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { PushNotificationsService } from '../push-notifications/push-notifications.service.js';
import { Logger } from '@nestjs/common';

@Controller('requests')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class RequestsController {
  private readonly logger = new Logger(RequestsController.name);

  constructor(
    private readonly requestsService: RequestsService,
    private readonly uploadsService: UploadsService,
    private readonly eventsService: RequestsEventsService,
    private readonly pushService: PushNotificationsService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.REQUEST_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'Request' })
  async create(
    @Body() dto: CreateRequestDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const result = await this.requestsService.create(dto, user.userId);
    const createEvent = {
      type: 'created',
      requestId: result.id,
      agentId: user.userId,
      registrationNumber: result.registrationNumber,
      requestType: result.requestType as 'NOVA_POLICA' | 'VNOSKA',
      newStatus: 'ZAYAVENA',
      actorRole: 'AGENT' as const,
    };
    this.eventsService.emit(createEvent);
    this.pushService.sendRequestEvent(createEvent).catch((err) => this.logger.error('Push notification failed:', err));
    return result;
  }

  @Get()
  @RequirePermissions(PERMISSIONS.REQUEST_READ_ALL)
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: RequestStatus,
    @Query('requestType') requestType?: RequestType,
    @Query('agentId') agentId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.requestsService.findAll(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      status,
      requestType,
      agentId,
      dateFrom,
      dateTo,
    );
  }

  @Get('my')
  @RequirePermissions(PERMISSIONS.REQUEST_READ_OWN)
  async findMyRequests(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: RequestStatus,
    @Query('requestType') requestType?: RequestType,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.requestsService.findMyRequests(
      user.userId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      status,
      requestType,
      dateFrom,
      dateTo,
    );
  }

  /**
   * Batch-check most recent non-cancelled request per registration number.
   * Used by insurance page to grey out the "Заяви" button when a recent
   * request already exists for that car.
   */
  @Get('check-by-reg')
  @RequirePermissions(PERMISSIONS.REQUEST_READ_OWN)
  async checkByReg(@Query('regs') regs: string) {
    if (!regs) return {};
    const registrationNumbers = regs
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    return this.requestsService.checkActiveByRegs(registrationNumbers);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.REQUEST_READ_OWN)
  async findOne(@Param('id') id: string) {
    return this.requestsService.findOne(id);
  }

  // Staff: decline a request
  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.REQUEST_UPDATE_STATUS)
  @Audit({ action: 'UPDATE_STATUS', entityType: 'Request' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRequestStatusDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const result = await this.requestsService.updateStatus(id, dto.status, user.userId, dto.cancellationNote);
    const statusEvent = {
      type: 'status-changed',
      requestId: id,
      agentId: result.agentId,
      registrationNumber: result.registrationNumber,
      requestType: result.requestType as 'NOVA_POLICA' | 'VNOSKA',
      newStatus: result.status,
      actorRole: 'STAFF' as const,
    };
    this.eventsService.emit(statusEvent);
    this.pushService.sendRequestEvent(statusEvent).catch((err) => this.logger.error('Push notification failed:', err));
    return result;
  }

  // Agent: cancel own request (ZAYAVENA only — misclick protection)
  @Patch(':id/cancel')
  @RequirePermissions(PERMISSIONS.REQUEST_CREATE)
  @Audit({ action: 'CANCEL_OWN', entityType: 'Request' })
  async cancelOwnRequest(
    @Param('id') id: string,
    @Body() dto: CancelRequestDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const result = await this.requestsService.cancelOwnRequest(id, user.userId, dto.cancellationNote);
    const cancelEvent = {
      type: 'status-changed',
      requestId: id,
      agentId: result.agentId,
      registrationNumber: result.registrationNumber,
      requestType: result.requestType as 'NOVA_POLICA' | 'VNOSKA',
      newStatus: 'OTKAZANA_OT_AGENT',
      actorRole: 'AGENT' as const,
    };
    this.eventsService.emit(cancelEvent);
    this.pushService.sendRequestEvent(cancelEvent).catch((err) => this.logger.error('Push notification failed:', err));
    return result;
  }

  // Agent: respond to offer (OBRABOTENA -> PRIETA_OFERTA / OTKAZANA_OFERTA)
  @Patch(':id/respond')
  @RequirePermissions(PERMISSIONS.REQUEST_RESPOND_OFFER)
  @Audit({ action: 'RESPOND_OFFER', entityType: 'Request' })
  async respondToOffer(
    @Param('id') id: string,
    @Body() dto: RespondOfferDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const result = await this.requestsService.respondToOffer(id, dto, user.userId);
    const respondEvent = {
      type: 'offer-responded',
      requestId: id,
      agentId: user.userId,
      registrationNumber: result.registrationNumber,
      requestType: result.requestType as 'NOVA_POLICA' | 'VNOSKA',
      newStatus: result.status,
      actorRole: 'AGENT' as const,
    };
    this.eventsService.emit(respondEvent);
    this.pushService.sendRequestEvent(respondEvent).catch((err) => this.logger.error('Push notification failed:', err));
    return result;
  }

  // Upload request photos (agent, max 2) — NOVA_POLICA only
  @Post(':id/images')
  @RequirePermissions(PERMISSIONS.REQUEST_CREATE)
  @Audit({ action: 'UPLOAD_PHOTOS', entityType: 'Request' })
  @UseInterceptors(
    FilesInterceptor('images', 2, {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadRequestImages(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const existingCount = await this.requestsService.getRequestImageCount(id, RequestImageType.photo);
    if (existingCount + files.length > 2) {
      throw new BadRequestException(
        `Максимум 2 снимки на заявка. Текущи: ${existingCount}, нови: ${files.length}`,
      );
    }

    const processedImages = await this.uploadsService.processAndSaveFiles(
      files, `req-${id}`, existingCount + 1, 'requests',
    );

    await this.requestsService.saveRequestImages(id, processedImages, RequestImageType.photo);

    return { uploaded: processedImages.length, images: processedImages };
  }

  // Staff: upload offer photos and transition ZAYAVENA -> OBRABOTENA (NOVA_POLICA only)
  @Post(':id/offer')
  @RequirePermissions(PERMISSIONS.REQUEST_UPDATE_STATUS)
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @Audit({ action: 'UPLOAD_OFFER', entityType: 'Request' })
  async uploadOfferAndProcess(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: CurrentUserData,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Трябва да качите поне една снимка на оферта');
    }

    const request = await this.requestsService.findOne(id);
    if (request.status !== RequestStatus.ZAYAVENA) {
      throw new BadRequestException('Заявката трябва да е в статус "Заявена" за обработка');
    }

    const existingOffers = await this.requestsService.getRequestImageCount(id, RequestImageType.offer);
    const processedImages = await this.uploadsService.processAndSaveFiles(
      files, `req-${id}-offer`, existingOffers + 1, 'requests',
    );

    await this.requestsService.saveRequestImages(id, processedImages, RequestImageType.offer);

    // Auto-transition to OBRABOTENA
    await this.requestsService.updateStatus(id, RequestStatus.OBRABOTENA, user.userId);

    const offerEvent = {
      type: 'offer-uploaded',
      requestId: id,
      agentId: request.agentId,
      registrationNumber: request.registrationNumber,
      requestType: request.requestType as 'NOVA_POLICA' | 'VNOSKA',
      newStatus: 'OBRABOTENA',
      actorRole: 'STAFF' as const,
    };
    this.eventsService.emit(offerEvent);
    this.pushService.sendRequestEvent(offerEvent).catch((err) => this.logger.error('Push notification failed:', err));
    return { uploaded: processedImages.length, images: processedImages };
  }

  // Staff: append more offer photos without changing status (for OBRABOTENA)
  @Post(':id/offer/append')
  @RequirePermissions(PERMISSIONS.REQUEST_UPDATE_STATUS)
  @UseInterceptors(FilesInterceptor('images', 10, { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Audit({ action: 'APPEND_OFFER', entityType: 'Request' })
  async appendOfferPhotos(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) throw new BadRequestException('Трябва да качите поне една снимка');

    const request = await this.requestsService.findOne(id);
    if (request.status !== RequestStatus.OBRABOTENA) {
      throw new BadRequestException('Може да добавяте оферта снимки само при статус "Обработена"');
    }

    const existingOffers = await this.requestsService.getRequestImageCount(id, RequestImageType.offer);
    const processedImages = await this.uploadsService.processAndSaveFiles(files, `req-${id}-offer`, existingOffers + 1, 'requests');

    await this.requestsService.saveRequestImages(id, processedImages, RequestImageType.offer);
    return { uploaded: processedImages.length };
  }

  // Staff: copy request photo images to the matching vehicle
  @Post(':id/copy-to-vehicle')
  @RequirePermissions(PERMISSIONS.REQUEST_UPDATE_STATUS)
  @Audit({ action: 'COPY_PHOTOS_TO_VEHICLE', entityType: 'Request' })
  async copyPhotosToVehicle(@Param('id') id: string) {
    return this.requestsService.copyPhotosToVehicle(id);
  }

  // Staff: append more document photos without changing status (for ZAVURSHENA)
  @Post(':id/documents/append')
  @RequirePermissions(PERMISSIONS.REQUEST_UPLOAD_DOCUMENT)
  @UseInterceptors(FilesInterceptor('images', 5, { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Audit({ action: 'APPEND_DOCUMENT', entityType: 'Request' })
  async appendDocumentPhotos(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) throw new BadRequestException('Трябва да качите поне един документ');

    const request = await this.requestsService.findOne(id);
    if (request.status !== RequestStatus.ZAVURSHENA) {
      throw new BadRequestException('Може да добавяте документи само при статус "Завършена"');
    }

    const existingDocs = await this.requestsService.getRequestImageCount(id, RequestImageType.document);
    const processedImages = await this.uploadsService.processAndSaveFiles(files, `req-${id}-doc`, existingDocs + 1, 'requests', true);

    await this.requestsService.saveRequestImages(id, processedImages, RequestImageType.document);
    return { uploaded: processedImages.length };
  }

  // Staff: upload printable documents -> ZAVURSHENA
  // For NOVA_POLICA: requires PRIETA_OFERTA status
  // For VNOSKA: requires ZAYAVENA status
  @Post(':id/documents')
  @RequirePermissions(PERMISSIONS.REQUEST_UPLOAD_DOCUMENT)
  @UseInterceptors(
    FilesInterceptor('images', 5, {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @Audit({ action: 'UPLOAD_DOCUMENT', entityType: 'Request' })
  async uploadDocuments(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: CurrentUserData,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const request = await this.requestsService.findOne(id);

    // Type-aware status validation
    if (request.requestType === RequestType.VNOSKA) {
      if (request.status !== RequestStatus.ZAYAVENA) {
        throw new BadRequestException('Вноската трябва да е в статус "Заявена" за добавяне на документи');
      }
    } else {
      if (request.status !== RequestStatus.PRIETA_OFERTA) {
        throw new BadRequestException('Заявката трябва да е в статус "Приета оферта" за добавяне на документи');
      }
    }

    const existingDocs = await this.requestsService.getRequestImageCount(id, RequestImageType.document);
    const processedImages = await this.uploadsService.processAndSaveFiles(
      files, `req-${id}-doc`, existingDocs + 1, 'requests', true,
    );

    await this.requestsService.saveRequestImages(id, processedImages, RequestImageType.document);

    // Auto-transition to ZAVURSHENA
    await this.requestsService.updateStatus(id, RequestStatus.ZAVURSHENA, user.userId);

    const docsEvent = {
      type: 'documents-uploaded',
      requestId: id,
      agentId: request.agentId,
      registrationNumber: request.registrationNumber,
      requestType: request.requestType as 'NOVA_POLICA' | 'VNOSKA',
      newStatus: 'ZAVURSHENA',
      actorRole: 'STAFF' as const,
    };
    this.eventsService.emit(docsEvent);
    this.pushService.sendRequestEvent(docsEvent).catch((err) => this.logger.error('Push notification failed:', err));
    return { uploaded: processedImages.length, images: processedImages };
  }

  @Get(':id/copy-to-vehicle/status')
  @RequirePermissions(PERMISSIONS.REQUEST_UPDATE_STATUS)
  async getCopyToVehicleStatus(@Param('id') id: string) {
    return this.requestsService.getCopyToVehicleStatus(id);
  }

  @Delete('images/:imageId')
  @RequirePermissions(PERMISSIONS.REQUEST_UPDATE_STATUS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE_REQUEST_IMAGE', entityType: 'Request' })
  async deleteRequestImage(@Param('imageId') imageId: string) {
    await this.requestsService.deleteRequestImage(imageId);
  }
}
