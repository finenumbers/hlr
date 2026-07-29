import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthLiveResponse, HealthReadyResponse } from '@finenumbers/contracts';

import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): HealthLiveResponse {
    return this.healthService.live();
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (postgres + redis)' })
  ready(): Promise<HealthReadyResponse> {
    return this.healthService.ready();
  }
}
