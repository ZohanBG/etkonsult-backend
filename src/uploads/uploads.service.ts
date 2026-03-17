import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { fileTypeFromBuffer } from 'file-type';
import * as pdfPoppler from 'pdf-poppler';
import * as os from 'os';

export interface ProcessedImage {
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
}

// Allowed MIME types for uploads
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

// Transaction client type for Prisma
type TransactionClient = Omit<
  PrismaService,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly baseUploadsDir = path.join(process.cwd(), 'uploads');
  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB
  private readonly webpQuality = 80;

  constructor(private readonly prisma: PrismaService) {}

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Validate file using file-type library (checks magic bytes)
   * More secure than checking MIME type which can be spoofed
   */
  private async validateFileType(buffer: Buffer): Promise<{ valid: boolean; detectedType: string | null }> {
    if (buffer.length < 12) {
      return { valid: false, detectedType: null };
    }

    const fileType = await fileTypeFromBuffer(buffer);

    if (!fileType) {
      return { valid: false, detectedType: null };
    }

    const isAllowed = ALLOWED_MIME_TYPES.has(fileType.mime);

    return {
      valid: isAllowed,
      detectedType: fileType.mime
    };
  }

  /**
   * Convert PDF first page to image buffer using pdf-poppler
   */
  private async pdfToImageBuffer(pdfBuffer: Buffer): Promise<Buffer> {
    const tempDir = os.tmpdir();
    const tempPdfPath = path.join(tempDir, `temp-${Date.now()}.pdf`);
    const tempOutputBase = path.join(tempDir, `temp-${Date.now()}`);

    try {
      // Write PDF to temp file
      await fs.writeFile(tempPdfPath, pdfBuffer);

      // Convert first page to PNG
      const opts = {
        format: 'png' as const,
        out_dir: tempDir,
        out_prefix: path.basename(tempOutputBase),
        page: 1,
        scale: 2048, // Good resolution for OCR
      };

      await pdfPoppler.convert(tempPdfPath, opts);

      // Read the generated image (pdf-poppler adds -1.png for first page)
      const outputPath = `${tempOutputBase}-1.png`;
      const imageBuffer = await fs.readFile(outputPath);

      // Cleanup temp files
      await fs.unlink(tempPdfPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});

      return imageBuffer;
    } catch (error) {
      // Cleanup on error
      await fs.unlink(tempPdfPath).catch(() => {});
      this.logger.error('PDF conversion failed:', error);
      throw new BadRequestException('Failed to process PDF file');
    }
  }

  private getDateFolder(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async processAndSaveImage(
    file: Express.Multer.File,
    entityId: string,
    imageIndex: number,
    subDir: string = 'vehicles',
    saveRaw: boolean = false,
  ): Promise<ProcessedImage> {
    // Validate file exists
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate file size first (before processing)
    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `File too large: ${Math.round(file.size / 1024 / 1024)}MB. Max: ${this.maxFileSize / 1024 / 1024}MB`,
      );
    }

    // Validate file type using magic bytes (more secure than MIME type)
    const { valid, detectedType } = await this.validateFileType(file.buffer);
    if (!valid || !detectedType) {
      throw new BadRequestException(
        'Invalid file type. Only JPEG, PNG, WebP, and PDF files are allowed.',
      );
    }

    this.logger.log(`Processing file: ${file.originalname}, detected type: ${detectedType}`);

    // Create date-based folder under the chosen subdirectory
    const dateFolder = this.getDateFolder();
    const targetDir = path.join(this.baseUploadsDir, subDir, dateFolder);
    await this.ensureDir(targetDir);

    if (saveRaw) {
      // Save the original file without any conversion
      const ext = detectedType === 'application/pdf' ? 'pdf'
        : detectedType === 'image/jpeg' ? 'jpg'
        : detectedType === 'image/png' ? 'png'
        : detectedType === 'image/webp' ? 'webp'
        : 'bin';
      const filename = `${entityId}_${imageIndex}.${ext}`;
      const filePath = path.join(targetDir, filename);
      const relativePath = path.join(subDir, dateFolder, filename);

      await fs.writeFile(filePath, file.buffer);

      this.logger.log(`Saved raw file: ${relativePath}, size: ${file.buffer.length} bytes`);

      return {
        path: relativePath.replace(/\\/g, '/'),
        originalName: file.originalname,
        mimeType: detectedType,
        size: file.buffer.length,
      };
    }

    // Generate filename: {entityId}_{index}.webp
    const filename = `${entityId}_${imageIndex}.webp`;
    const filePath = path.join(targetDir, filename);
    const relativePath = path.join(subDir, dateFolder, filename);

    let imageBuffer: Buffer;

    // Handle PDF - convert first page to image
    if (detectedType === 'application/pdf') {
      this.logger.log('Converting PDF to image...');
      imageBuffer = await this.pdfToImageBuffer(file.buffer);
    } else {
      imageBuffer = file.buffer;
    }

    // Convert to WebP and save
    const processedBuffer = await sharp(imageBuffer)
      .webp({ quality: this.webpQuality })
      .toBuffer();

    await fs.writeFile(filePath, processedBuffer);

    this.logger.log(`Saved image: ${relativePath}, size: ${processedBuffer.length} bytes`);

    return {
      path: relativePath.replace(/\\/g, '/'), // Normalize path separators
      originalName: file.originalname,
      mimeType: 'image/webp',
      size: processedBuffer.length,
    };
  }

  /**
   * Safely resolve a file path within the uploads directory.
   * Prevents path traversal attacks.
   */
  private safeResolvePath(relativePath: string): string {
    const fullPath = path.resolve(this.baseUploadsDir, relativePath);
    if (!fullPath.startsWith(this.baseUploadsDir + path.sep) && fullPath !== this.baseUploadsDir) {
      throw new BadRequestException('Invalid file path');
    }
    return fullPath;
  }

  /**
   * Clean up files from filesystem (used for rollback on failure)
   */
  async cleanupFiles(filePaths: string[]): Promise<void> {
    for (const relativePath of filePaths) {
      const fullPath = this.safeResolvePath(relativePath);
      try {
        await fs.unlink(fullPath);
        this.logger.log(`Cleaned up file: ${relativePath}`);
      } catch {
        this.logger.warn(`Failed to cleanup file: ${relativePath}`);
      }
    }
  }

  /**
   * Process and save images to filesystem only (no DB operations)
   * Returns processed images and their paths for potential cleanup.
   * subDir controls which uploads sub-folder to use ('vehicles' or 'requests').
   */
  async processAndSaveFiles(
    files: Express.Multer.File[],
    entityId: string,
    startIndex: number = 1,
    subDir: string = 'vehicles',
    saveRaw: boolean = false,
  ): Promise<ProcessedImage[]> {
    const processedImages: ProcessedImage[] = [];

    for (let i = 0; i < files.length; i++) {
      const imageIndex = startIndex + i;
      const processed = await this.processAndSaveImage(files[i], entityId, imageIndex, subDir, saveRaw);
      processedImages.push(processed);
    }

    return processedImages;
  }

  /**
   * Upload images with transaction support
   * If tx is provided, uses that transaction; otherwise creates its own
   */
  async uploadVehicleImages(
    files: Express.Multer.File[],
    vehicleId: string,
    tx?: TransactionClient,
  ): Promise<ProcessedImage[]> {
    if (!files || files.length === 0) {
      return [];
    }

    const client = tx || this.prisma;

    // Get current image count for this vehicle to determine starting index
    const existingCount = await client.vehicleImage.count({
      where: { vehicleId },
    });

    // First, process and save all files to filesystem
    const processedImages = await this.processAndSaveFiles(
      files,
      vehicleId,
      existingCount + 1,
    );

    try {
      // Then save to database
      for (const processed of processedImages) {
        await client.vehicleImage.create({
          data: {
            vehicleId,
            path: processed.path,
            originalName: processed.originalName,
            mimeType: processed.mimeType,
            size: processed.size,
          },
        });
      }

      return processedImages;
    } catch (error) {
      // If DB operations fail, clean up the files we saved
      this.logger.error('Failed to save images to database, cleaning up files...');
      await this.cleanupFiles(processedImages.map((img) => img.path));
      throw error;
    }
  }

  /**
   * Upload images within a transaction wrapper
   * Handles both file and DB cleanup on failure
   */
  async uploadVehicleImagesWithTransaction(
    files: Express.Multer.File[],
    vehicleId: string,
  ): Promise<ProcessedImage[]> {
    if (!files || files.length === 0) {
      return [];
    }

    // Get current image count before transaction
    const existingCount = await this.prisma.vehicleImage.count({
      where: { vehicleId },
    });

    // First, process and save all files to filesystem
    const processedImages = await this.processAndSaveFiles(
      files,
      vehicleId,
      existingCount + 1,
    );

    try {
      // Use transaction for DB operations
      await this.prisma.$transaction(async (tx) => {
        for (const processed of processedImages) {
          await tx.vehicleImage.create({
            data: {
              vehicleId,
              path: processed.path,
              originalName: processed.originalName,
              mimeType: processed.mimeType,
              size: processed.size,
            },
          });
        }
      });

      return processedImages;
    } catch (error) {
      // If DB transaction fails, clean up the files we saved
      this.logger.error('Transaction failed, cleaning up uploaded files...');
      await this.cleanupFiles(processedImages.map((img) => img.path));
      throw error;
    }
  }

  async deleteVehicleImage(imageId: string): Promise<void> {
    const image = await this.prisma.vehicleImage.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      throw new BadRequestException('Image not found');
    }

    // Delete file from filesystem (with path traversal protection)
    const filePath = this.safeResolvePath(image.path);
    try {
      await fs.unlink(filePath);
    } catch {
      // File might not exist, continue with DB deletion
    }

    // Delete from database
    await this.prisma.vehicleImage.delete({
      where: { id: imageId },
    });
  }

  async deleteAllVehicleImages(vehicleId: string): Promise<void> {
    const images = await this.prisma.vehicleImage.findMany({
      where: { vehicleId },
    });

    // Delete files from filesystem (with path traversal protection)
    for (const image of images) {
      const filePath = this.safeResolvePath(image.path);
      try {
        await fs.unlink(filePath);
      } catch {
        // Continue even if file doesn't exist
      }
    }

    // Delete from database
    await this.prisma.vehicleImage.deleteMany({
      where: { vehicleId },
    });
  }

  async getVehicleImages(vehicleId: string) {
    return this.prisma.vehicleImage.findMany({
      where: { vehicleId },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  async getVehicleImageCount(vehicleId: string): Promise<number> {
    return this.prisma.vehicleImage.count({
      where: { vehicleId },
    });
  }
}
