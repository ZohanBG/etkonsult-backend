import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { SessionService } from '../../auth/services/session.service.js';

/**
 * Middleware that protects the /uploads static file route.
 * Validates auth_token cookie before allowing file access.
 */
@Injectable()
export class UploadsAuthMiddleware implements NestMiddleware {
  constructor(private readonly sessionService: SessionService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const token = req.cookies?.['auth_token'];
    const fingerprint =
      (req.headers['x-fingerprint'] as string) ||
      (req.query?.['fingerprint'] as string);

    if (!token || !fingerprint) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const session = await this.sessionService.validateSession(token, fingerprint);
    if (!session) {
      res.status(401).json({ message: 'Invalid or expired session' });
      return;
    }

    next();
  }
}
