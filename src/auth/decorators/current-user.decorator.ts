import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface CurrentUserData {
  userId: string;
  sessionId: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext): CurrentUserData | string => {
    const request = ctx.switchToHttp().getRequest<Request & { user: CurrentUserData }>();
    const user = request.user;

    if (data) {
      return user[data];
    }

    return user;
  },
);
