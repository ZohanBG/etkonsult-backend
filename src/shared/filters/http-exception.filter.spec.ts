import {
  HttpException,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ArgumentsHost,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockAuditService: { log: jest.Mock };
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockRequest: Record<string, unknown>;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    mockAuditService = { log: jest.fn().mockResolvedValue(undefined) };
    filter = new HttpExceptionFilter(mockAuditService as any);

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockRequest = {
      url: '/api/test',
      method: 'GET',
      headers: { 'user-agent': 'test' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;
  });

  it('formats HttpException with string response', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Not found',
        path: '/api/test',
      }),
    );
  });

  it('formats HttpException with object response', () => {
    const exception = new BadRequestException('Validation failed');
    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        path: '/api/test',
      }),
    );
  });

  it('formats generic Error', () => {
    const exception = new TypeError('Cannot read property');
    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Cannot read property',
        error: 'TypeError',
      }),
    );
  });

  it('handles unknown exception type', () => {
    filter.catch('some string error', mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
  });

  it('does not audit 4xx errors', () => {
    const exception = new NotFoundException('Not found');
    filter.catch(exception, mockHost);

    expect(mockAuditService.log).not.toHaveBeenCalled();
  });

  it('audits 5xx errors', () => {
    const exception = new Error('DB connection failed');
    filter.catch(exception, mockHost);

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SERVER_ERROR',
        entityType: 'Error',
        entityId: '500',
      }),
    );
  });

  it('includes timestamp in response', () => {
    const exception = new BadRequestException('bad');
    filter.catch(exception, mockHost);

    const response = mockResponse.json.mock.calls[0][0];
    expect(response.timestamp).toBeDefined();
    expect(new Date(response.timestamp).getTime()).not.toBeNaN();
  });
});
