import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuditService } from '../../audit/audit.service.js';

export interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly auditService: AuditService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = (responseObj.message as string | string[]) || message;
        error = (responseObj.error as string) || exception.name;
      }
    } else if (exception instanceof Error) {
      // In production, never leak internal error details to the client
      if (process.env.NODE_ENV !== 'production') {
        message = exception.message;
        error = exception.name;
      }
    }

    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(errorResponse);

    // Audit server errors (5xx)
    if (statusCode >= 500) {
      const userId = (request as Request & { user?: { userId: string } }).user?.userId;
      const ipAddress =
        (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        request.ip ||
        request.socket?.remoteAddress;

      this.auditService
        .log({
          userId,
          action: 'SERVER_ERROR',
          entityType: 'Error',
          entityId: String(statusCode),
          newValue: {
            statusCode,
            error,
            message: Array.isArray(message) ? message.join('; ') : message,
            path: request.url,
            method: request.method,
            stack: process.env.NODE_ENV !== 'production' && exception instanceof Error ? exception.stack?.slice(0, 500) : undefined,
          },
          ipAddress,
          userAgent: request.headers['user-agent'],
        })
        .catch(() => {
          // Never let audit failure affect the response
        });
    }
  }
}
