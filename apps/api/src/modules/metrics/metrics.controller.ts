import {
  Controller,
  Get,
  Header,
  Headers,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { AppConfigService } from '../../common/config/app-config.service';
import { Public } from '../../common/decorators/public.decorator';
import { ErrorCodes } from '../../common/errors/error-codes';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metricsText(
    @Headers('authorization') authorization?: string,
  ): Promise<string> {
    if (!this.config.metricsEnabled) {
      throw new ServiceUnavailableException('Metrics disabled');
    }
    const token = this.config.metricsScrapeToken;
    if (token) {
      const expected = `Bearer ${token}`;
      if (authorization !== expected) {
        throw new UnauthorizedException({
          errorCode: ErrorCodes.UNAUTHORIZED,
          message: 'Metrics scrape token required',
        });
      }
    }
    return this.metrics.render();
  }
}
