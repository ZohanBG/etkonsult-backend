import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateClientDto, CreateDirectoryDto, UpdateDirectoryDto } from './dto/index.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

@Injectable()
export class ClientDocumentsService {
  private readonly logger = new Logger(ClientDocumentsService.name);
  private readonly baseDir = path.join(process.cwd(), 'uploads', 'clients');

  constructor(private readonly prisma: PrismaService) {}

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  async listClients(opts: {
    page?: number;
    limit?: number;
    search?: string;
    withDocuments?: 'all' | 'with' | 'without';
    nameFilter?: string;
    identifierFilter?: string;
    phoneFilter?: string;
    emailFilter?: string;
    addressFilter?: string;
  }) {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const search = opts.search?.trim();
    const withDocs = opts.withDocuments ?? 'all';

    const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });
    const conditions: Record<string, unknown>[] = [];

    if (withDocs === 'with') {
      conditions.push({ clientDirectories: { some: {} } });
    } else if (withDocs === 'without') {
      conditions.push({ clientDirectories: { none: {} } });
    }
    if (search) {
      conditions.push({
        OR: [{ name: ci(search) }, { identifier: ci(search) }],
      });
    }
    if (opts.nameFilter?.trim()) conditions.push({ name: ci(opts.nameFilter.trim()) });
    if (opts.identifierFilter?.trim()) conditions.push({ identifier: ci(opts.identifierFilter.trim()) });
    if (opts.phoneFilter?.trim()) conditions.push({ phone: ci(opts.phoneFilter.trim()) });
    if (opts.emailFilter?.trim()) conditions.push({ email: ci(opts.emailFilter.trim()) });
    if (opts.addressFilter?.trim()) conditions.push({ address: ci(opts.addressFilter.trim()) });

    const where = conditions.length ? { AND: conditions } : {};

    const [clients, total] = await Promise.all([
      this.prisma.owner.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          clientDirectories: {
            select: {
              id: true,
              name: true,
              updatedAt: true,
              _count: { select: { documents: true } },
            },
            orderBy: { name: 'asc' },
          },
        },
      }),
      this.prisma.owner.count({ where }),
    ]);

    return {
      data: clients,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getClient(ownerId: string) {
    const owner = await this.prisma.owner.findUnique({
      where: { id: ownerId },
      include: {
        clientDirectories: {
          orderBy: { name: 'asc' },
          include: {
            documents: {
              orderBy: { uploadedAt: 'desc' },
              select: {
                id: true,
                originalName: true,
                mimeType: true,
                size: true,
                uploadedAt: true,
                path: true,
                rotation: true,
              },
            },
          },
        },
      },
    });
    if (!owner) {
      throw new NotFoundException('Клиентът не е намерен');
    }
    return owner;
  }

  async createClient(dto: CreateClientDto) {
    const existing = await this.prisma.owner.findUnique({
      where: { identifier: dto.identifier },
    });
    if (existing) {
      throw new ConflictException('Клиент с този ЕГН/ЕИК/ЛНЧ вече съществува');
    }
    return this.prisma.owner.create({ data: dto });
  }

  async createDirectory(ownerId: string, dto: CreateDirectoryDto, userId: string) {
    const owner = await this.prisma.owner.findUnique({ where: { id: ownerId } });
    if (!owner) {
      throw new NotFoundException('Клиентът не е намерен');
    }
    return this.prisma.clientDirectory.create({
      data: { ownerId, name: dto.name.trim(), createdById: userId },
    });
  }

  async renameDirectory(directoryId: string, dto: UpdateDirectoryDto) {
    const dir = await this.prisma.clientDirectory.findUnique({ where: { id: directoryId } });
    if (!dir) {
      throw new NotFoundException('Директорията не е намерена');
    }
    return this.prisma.clientDirectory.update({
      where: { id: directoryId },
      data: { name: dto.name.trim() },
    });
  }

  async deleteDirectory(directoryId: string) {
    const dir = await this.prisma.clientDirectory.findUnique({
      where: { id: directoryId },
      include: { documents: true },
    });
    if (!dir) {
      throw new NotFoundException('Директорията не е намерена');
    }

    const dirPath = path.join(this.baseDir, dir.ownerId, dir.id);

    // DB cascade-deletes documents; remove the folder from disk
    await this.prisma.clientDirectory.delete({ where: { id: directoryId } });
    await fs.rm(dirPath, { recursive: true, force: true }).catch((err) => {
      this.logger.warn(`Failed to remove directory folder ${dirPath}: ${err.message}`);
    });
  }

  async uploadDocuments(
    directoryId: string,
    files: Express.Multer.File[],
    userId: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Не са избрани файлове');
    }

    const dir = await this.prisma.clientDirectory.findUnique({
      where: { id: directoryId },
      select: { id: true, ownerId: true },
    });
    if (!dir) {
      throw new NotFoundException('Директорията не е намерена');
    }

    const dirPath = path.join(this.baseDir, dir.ownerId, dir.id);
    await this.ensureDir(dirPath);

    const created: { id: string; originalName: string; size: number; mimeType: string }[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        throw new BadRequestException(
          `Файлът "${file.originalname}" надхвърля максималния размер от 20 MB`,
        );
      }

      const ext = path.extname(file.originalname) || '';
      const storedName = `${randomUUID()}${ext}`;
      const filePath = path.join(dirPath, storedName);
      await fs.writeFile(filePath, file.buffer);

      const relativePath = path.posix.join('clients', dir.ownerId, dir.id, storedName);

      const doc = await this.prisma.clientDocument.create({
        data: {
          directoryId: dir.id,
          path: relativePath,
          originalName: file.originalname,
          mimeType: file.mimetype || 'application/octet-stream',
          size: file.size,
          uploadedById: userId,
        },
        select: { id: true, originalName: true, size: true, mimeType: true },
      });
      created.push(doc);
    }

    return { uploaded: created.length, documents: created };
  }

  async deleteDocument(documentId: string) {
    const doc = await this.prisma.clientDocument.findUnique({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException('Документът не е намерен');
    }

    await this.prisma.clientDocument.delete({ where: { id: documentId } });

    const filePath = path.join(process.cwd(), 'uploads', doc.path);
    await fs.unlink(filePath).catch((err) => {
      this.logger.warn(`Failed to remove file ${filePath}: ${err.message}`);
    });
  }

  async setDocumentRotation(documentId: string, rotation: number) {
    const normalized = ((Math.round(rotation) % 360) + 360) % 360;
    return this.prisma.clientDocument.update({
      where: { id: documentId },
      data: { rotation: normalized },
      select: { id: true, rotation: true },
    });
  }
}
