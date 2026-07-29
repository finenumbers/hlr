import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ErrorCodes } from '../../common/errors/error-codes';
import { IpRateLimit, IpRateLimitGuard } from '../../common/guards/ip-rate-limit.guard';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuthService } from './auth.service';
import { AuthSessionResponseDto } from './dto/auth-session-response.dto';
import { AuthUserResponseDto } from './dto/auth-user-response.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit({ scope: 'auth_login' })
  @ApiOperation({ summary: 'Login with email/password; returns opaque session token' })
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthSessionResponseDto> {
    return this.authService.login(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('logout')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit({ scope: 'auth_logout' })
  @ApiOperation({ summary: 'Revoke current session token (best-effort)' })
  logout(@Req() req: Request): Promise<{ ok: true }> {
    const token = extractBearer(req.headers.authorization);
    return this.authService.logout(token);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current authenticated user + memberships' })
  me(@CurrentUser() user?: AuthenticatedUser): Promise<AuthUserResponseDto> {
    if (!user) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Authentication required',
      });
    }
    return this.authService.getCurrentUser(user);
  }
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) {
    return undefined;
  }
  return header.slice('Bearer '.length).trim() || undefined;
}
