import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../services/session.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Get token from Authorization header or cookie
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    // Get fingerprint from header; query param fallback for GET requests
    const fingerprint = (request.headers['x-fingerprint'] as string) ||
      (request.method === 'GET' ? (request.query?.['fingerprint'] as string) : undefined);
    if (!fingerprint) {
      throw new UnauthorizedException('Device fingerprint required');
    }

    // Get current IP address
    const currentIpAddress = this.extractIpAddress(request);

    // Validate session with fingerprint and IP
    const session = await this.sessionService.validateSession(token, fingerprint, currentIpAddress);
    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Attach user info to request
    (request as Request & { user: { userId: string; sessionId: string } }).user = {
      userId: session.userId,
      sessionId: session.sessionId,
    };

    return true;
  }

  private extractToken(request: Request): string | null {
    // Try Authorization header first (Bearer token)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Try cookie
    const cookieToken = request.cookies?.['auth_token'];
    if (cookieToken) {
      return cookieToken;
    }

    return null;
  }

  private extractIpAddress(request: Request): string | undefined {
    // Check for forwarded IP (behind proxy/load balancer)
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      // x-forwarded-for can be a comma-separated list, take the first one
      const ips = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',');
      return ips[0]?.trim();
    }

    // Check for real IP header (nginx)
    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    // Fallback to direct connection IP
    return request.ip || request.socket?.remoteAddress;
  }
}
