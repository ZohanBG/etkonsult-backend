import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_LENGTH = 32;

/**
 * Double-submit cookie CSRF protection.
 *
 * On every request:
 *   - If no csrf_token cookie exists, set one
 *   - For state-changing methods (POST, PATCH, DELETE, PUT),
 *     validate that the x-csrf-token header matches the cookie
 *
 * This works alongside SameSite=strict cookies + fingerprint
 * as defense-in-depth.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Ensure a CSRF cookie always exists
    let cookieToken = req.cookies?.[CSRF_COOKIE];
    if (!cookieToken) {
      cookieToken = randomBytes(TOKEN_LENGTH).toString('hex');
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie(CSRF_COOKIE, cookieToken, {
        httpOnly: false, // Must be readable by JavaScript
        secure: isProduction,
        sameSite: isProduction ? 'strict' : 'lax',
        path: '/',
        ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
      });
    }

    // Always expose the token in a response header so cross-subdomain JS can read it
    res.setHeader('X-CSRF-Token', cookieToken);

    // Safe methods don't need CSRF validation
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    // Validate CSRF token on state-changing methods
    const headerToken = req.headers[CSRF_HEADER] as string;
    if (!headerToken || !cookieToken) {
      res.status(403).json({ message: 'CSRF token missing' });
      return;
    }

    // Timing-safe comparison
    const cookieBuf = Buffer.from(cookieToken, 'utf8');
    const headerBuf = Buffer.from(headerToken, 'utf8');
    if (cookieBuf.length !== headerBuf.length || !timingSafeEqual(cookieBuf, headerBuf)) {
      res.status(403).json({ message: 'CSRF token mismatch' });
      return;
    }

    next();
  }
}
