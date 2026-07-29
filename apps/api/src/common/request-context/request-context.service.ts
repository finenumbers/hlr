import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import type { RequestContextStore } from './request-context.types';

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(store: RequestContextStore, fn: () => T): T {
    return this.storage.run(store, fn);
  }

  getStore(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  get requestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  get userId(): string | undefined {
    return this.storage.getStore()?.userId;
  }

  get tenantId(): string | undefined {
    return this.storage.getStore()?.tenantId;
  }

  setUserId(userId: string | undefined): void {
    const store = this.storage.getStore();
    if (store) {
      store.userId = userId;
    }
  }

  setTenantId(tenantId: string | undefined): void {
    const store = this.storage.getStore();
    if (store) {
      store.tenantId = tenantId;
    }
  }
}
