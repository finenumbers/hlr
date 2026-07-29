import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end') {
      return;
    }
    await this.client.quit();
  }

  async ping(): Promise<string> {
    if (this.client.status !== 'ready') {
      await this.client.connect();
    }
    return this.client.ping();
  }
}
