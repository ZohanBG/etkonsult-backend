import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ResourceItemType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSectionDto, UpdateSectionDto, CreateLinkItemDto, UpdateItemDto } from './dto/index.js';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { fileTypeFromBuffer } from 'file-type';

// Blocked MIME types — executables, scripts, etc.
const BLOCKED_MIME_TYPES = new Set([
  'application/x-executable',
  'application/x-msdos-program',
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-sharedlib',
  'application/x-elf',
  'application/x-mach-binary',
]);

@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate file using magic bytes — block executables and dangerous types.
   */
  private async validateFile(file: Express.Multer.File): Promise<void> {
    if (file.buffer.length < 12) return; // Too small to detect
    const detected = await fileTypeFromBuffer(file.buffer);
    if (detected && BLOCKED_MIME_TYPES.has(detected.mime)) {
      throw new BadRequestException(`File type "${detected.mime}" is not allowed`);
    }
  }

  /**
   * Get all sections with their items, ordered by section order then item order
   */
  async getAllSections() {
    return this.prisma.resourceSection.findMany({
      include: {
        items: {
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Create a new section
   */
  async createSection(dto: CreateSectionDto) {
    // Auto-assign order if not provided
    if (dto.order === undefined) {
      const maxOrder = await this.prisma.resourceSection.aggregate({
        _max: { order: true },
      });
      dto.order = (maxOrder._max.order ?? -1) + 1;
    }

    return this.prisma.resourceSection.create({
      data: {
        name: dto.name,
        description: dto.description,
        order: dto.order,
      },
      include: {
        items: true,
      },
    });
  }

  /**
   * Update a section
   */
  async updateSection(id: string, dto: UpdateSectionDto) {
    const section = await this.prisma.resourceSection.findUnique({ where: { id } });
    if (!section) throw new NotFoundException('Секцията не е намерена');

    return this.prisma.resourceSection.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
      include: {
        items: {
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  /**
   * Delete a section and all its items (cascade) + cleanup files
   */
  async deleteSection(id: string) {
    const section = await this.prisma.resourceSection.findUnique({
      where: { id },
      include: { items: { where: { type: ResourceItemType.file } } },
    });
    if (!section) throw new NotFoundException('Секцията не е намерена');

    // Collect file paths before DB deletion
    const filePaths = section.items
      .filter((item) => item.filePath)
      .map((item) => item.filePath!);

    // Delete from DB first (cascade handles items)
    await this.prisma.resourceSection.delete({ where: { id } });

    // Then clean up physical files
    for (const fp of filePaths) {
      this.deleteFile(fp);
    }
  }

  /**
   * Add a link item to a section
   */
  async addLinkItem(sectionId: string, dto: CreateLinkItemDto) {
    const section = await this.prisma.resourceSection.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Секцията не е намерена');

    // Auto-assign order if not provided
    let order = dto.order;
    if (order === undefined) {
      const maxOrder = await this.prisma.resourceItem.aggregate({
        where: { sectionId },
        _max: { order: true },
      });
      order = (maxOrder._max.order ?? -1) + 1;
    }

    return this.prisma.resourceItem.create({
      data: {
        sectionId,
        type: ResourceItemType.link,
        title: dto.title,
        description: dto.description,
        url: dto.url,
        order,
      },
    });
  }

  /**
   * Upload a file item to a section
   */
  async addFileItem(
    sectionId: string,
    file: Express.Multer.File,
    title: string,
    description?: string,
  ) {
    const section = await this.prisma.resourceSection.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Секцията не е намерена');

    if (!file) throw new BadRequestException('Файлът е задължителен');

    await this.validateFile(file);

    // Save file to disk
    const uploadDir = path.join(process.cwd(), 'uploads', 'resources', sectionId);
    fs.mkdirSync(uploadDir, { recursive: true });

    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(uploadDir, filename);
    const relativePath = `uploads/resources/${sectionId}/${filename}`;

    fs.writeFileSync(filePath, file.buffer);

    // Auto-assign order
    const maxOrder = await this.prisma.resourceItem.aggregate({
      where: { sectionId },
      _max: { order: true },
    });
    const order = (maxOrder._max.order ?? -1) + 1;

    return this.prisma.resourceItem.create({
      data: {
        sectionId,
        type: ResourceItemType.file,
        title,
        description,
        filePath: relativePath,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        order,
      },
    });
  }

  /**
   * Upload multiple files to a section.
   * If folderName is provided, zips all files into a single .zip and creates one item.
   * Otherwise uploads each file individually.
   */
  async addFileItems(
    sectionId: string,
    files: Express.Multer.File[],
    description?: string,
    folderName?: string,
    relativePaths?: string[],
  ) {
    const section = await this.prisma.resourceSection.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Секцията не е намерена');

    if (!files || files.length === 0) throw new BadRequestException('Файловете са задължителни');

    // Validate all files before processing
    for (const file of files) {
      await this.validateFile(file);
    }

    // Get current max order
    const maxOrder = await this.prisma.resourceItem.aggregate({
      where: { sectionId },
      _max: { order: true },
    });
    let order = (maxOrder._max.order ?? -1) + 1;

    // If folderName is provided, zip all files into a single .zip
    if (folderName) {
      const item = await this.zipAndCreateItem(sectionId, folderName, files, relativePaths, description, order);
      return [item];
    }

    // Otherwise upload each file individually
    const uploadDir = path.join(process.cwd(), 'uploads', 'resources', sectionId);
    fs.mkdirSync(uploadDir, { recursive: true });

    // Write all files to disk first
    const fileData: Array<{
      title: string;
      filePath: string;
      originalName: string;
      mimeType: string;
      size: number;
      order: number;
    }> = [];

    for (const file of files) {
      const ext = path.extname(file.originalname);
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const diskPath = path.join(uploadDir, filename);
      const fileRelPath = `uploads/resources/${sectionId}/${filename}`;

      fs.writeFileSync(diskPath, file.buffer);

      fileData.push({
        title: file.originalname.replace(/\.[^.]+$/, ''),
        filePath: fileRelPath,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        order: order++,
      });
    }

    // Batch insert all items at once
    await this.prisma.resourceItem.createMany({
      data: fileData.map((f) => ({
        sectionId,
        type: ResourceItemType.file,
        title: f.title,
        description,
        filePath: f.filePath,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        order: f.order,
      })),
    });

    // Return created items
    return this.prisma.resourceItem.findMany({
      where: { sectionId, filePath: { in: fileData.map((f) => f.filePath) } },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Upload a whole folder: create a new section, zip all files into a single .zip item
   */
  async uploadFolder(
    folderName: string,
    files: Express.Multer.File[],
    description?: string,
    relativePaths?: string[],
  ) {
    if (!folderName?.trim()) throw new BadRequestException('Името на папката е задължително');
    if (!files || files.length === 0) throw new BadRequestException('Файловете са задължителни');

    for (const file of files) {
      await this.validateFile(file);
    }

    // Create a new section named after the folder
    const maxOrder = await this.prisma.resourceSection.aggregate({
      _max: { order: true },
    });
    const sectionOrder = (maxOrder._max.order ?? -1) + 1;

    const section = await this.prisma.resourceSection.create({
      data: {
        name: folderName.trim(),
        description: description || undefined,
        order: sectionOrder,
      },
    });

    // Zip all files and create a single item
    const item = await this.zipAndCreateItem(section.id, folderName, files, relativePaths, description, 0);

    return { ...section, items: [item] };
  }

  /**
   * Helper: zip files into a single .zip and create a resource item
   */
  private async zipAndCreateItem(
    sectionId: string,
    folderName: string,
    files: Express.Multer.File[],
    relativePaths: string[] | undefined,
    description: string | undefined,
    order: number,
  ) {
    const uploadDir = path.join(process.cwd(), 'uploads', 'resources', sectionId);
    fs.mkdirSync(uploadDir, { recursive: true });

    const zipFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`;
    const zipPath = path.join(uploadDir, zipFilename);
    const zipRelativePath = `uploads/resources/${sectionId}/${zipFilename}`;

    // Create zip
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err: Error) => reject(err));

      archive.pipe(output);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Use relative path if provided, otherwise just the filename
        const entryName = relativePaths?.[i] || file.originalname;
        archive.append(file.buffer, { name: entryName });
      }

      archive.finalize();
    });

    const zipStats = fs.statSync(zipPath);
    const zipOriginalName = `${folderName.trim()}.zip`;

    return this.prisma.resourceItem.create({
      data: {
        sectionId,
        type: ResourceItemType.file,
        title: folderName.trim(),
        description,
        filePath: zipRelativePath,
        originalName: zipOriginalName,
        mimeType: 'application/zip',
        size: zipStats.size,
        order,
      },
    });
  }

  /**
   * Update an item (title, description, url, order)
   */
  async updateItem(id: string, dto: UpdateItemDto) {
    const item = await this.prisma.resourceItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Елементът не е намерен');

    return this.prisma.resourceItem.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.url !== undefined && item.type === ResourceItemType.link && { url: dto.url }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });
  }

  /**
   * Delete an item + cleanup file if exists
   */
  async deleteItem(id: string) {
    const item = await this.prisma.resourceItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Елементът не е намерен');

    // Delete physical file
    if (item.type === ResourceItemType.file && item.filePath) {
      this.deleteFile(item.filePath);
    }

    await this.prisma.resourceItem.delete({ where: { id } });
  }

  /**
   * Safely resolve a file path within the uploads directory.
   * Prevents path traversal attacks by verifying the resolved path stays within bounds.
   */
  private safeResolvePath(relativePath: string): string {
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    const fullPath = path.resolve(process.cwd(), relativePath);
    if (!fullPath.startsWith(uploadsRoot + path.sep) && fullPath !== uploadsRoot) {
      throw new BadRequestException('Invalid file path');
    }
    return fullPath;
  }

  /**
   * Delete a file from disk (relative path from project root)
   */
  private deleteFile(relativePath: string) {
    try {
      const fullPath = this.safeResolvePath(relativePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Log but don't throw — file might already be deleted
      this.logger.warn(`Failed to delete file: ${relativePath}`);
    }
  }
}
