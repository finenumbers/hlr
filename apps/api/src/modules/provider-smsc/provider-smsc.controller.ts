import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { ProviderRequestsQueryDto } from './dto/provider-requests-query.dto';
import { ProviderSmscService } from './provider-smsc.service';

@ApiTags('provider-smsc')
@ApiBearerAuth()
@Controller('internal/provider-smsc')
export class ProviderSmscController {
  constructor(private readonly providerSmsc: ProviderSmscService) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'SMSC adapter readiness (no live SMSC calls)' })
  status() {
    return this.providerSmsc.getAdapterStatus();
  }

  @Public()
  @Get('requests')
  @ApiOperation({ summary: 'List recent SMSC provider requests from DB (scaffold)' })
  listRequests(@Query() query: ProviderRequestsQueryDto) {
    return this.providerSmsc.listRecentRequests(query.limit);
  }
}
