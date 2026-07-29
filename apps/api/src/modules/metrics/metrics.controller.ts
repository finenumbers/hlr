import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { AppConfigService } from '../../common/config/app-config.service';
import { Public } from '../../common/decorators/public.decorator';
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
  async metricsText(): Promise<string> {
    if (!this.config.metricsEnabled) {
      throw new ServiceUnavailableException('Metrics disabled');
    }
    return this.metrics.render();
  }
}
