import { Global, Module } from '@nestjs/common';
import { loadApiEnv } from '@finenumbers/config';

import { AppConfigService } from './app-config.service';
import { APP_CONFIG } from './app-config.tokens';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadApiEnv(),
    },
    AppConfigService,
  ],
  exports: [APP_CONFIG, AppConfigService],
})
export class AppConfigModule {}
