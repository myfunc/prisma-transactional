import { PrismaClient } from '@prisma/client';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import { TX_CLIENT_KEY, TRANSACTION_TIMEOUT, TX_CLIENT_SUCCESS_CALLBACKS } from './const';
import { Manager } from './manager';

// That solution can join transactions.
// Found here https://github.com/prisma/prisma/issues/5729
export { ClsService, ClsServiceManager };

/** That solution can creates and merge transactions.
      BE CAREFUL when using it, all queries inside transaction will be isolated and can lead to deadlock.
  
      Found here https://github.com/prisma/prisma/issues/5729
  */
export function PrismaTransactional(isolationLevel?: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: unknown[]) {
      return PrismaTransactional.execute(
        () => originalMethod.apply(this, [...args]),
        isolationLevel,
      );
    };
  };
}

// Utility to manage success callback queue
PrismaTransactional.onSuccess = <T>(callback: () => T | Promise<T>): T | Promise<T> | undefined => {
  const clsService = ClsServiceManager.getClsService();
  const isActiveTransaction = clsService.get(TX_CLIENT_KEY);

  if (isActiveTransaction) {
    const existingCallbacks = clsService.get(TX_CLIENT_SUCCESS_CALLBACKS) || [];
    clsService.set(TX_CLIENT_SUCCESS_CALLBACKS, [...existingCallbacks, callback]);
  } else {
    return callback();
  }
};

// Run callback in transaction
PrismaTransactional.execute = <T>(
  callback: () => Promise<T>,
  isolationLevel?: string,
): Promise<T> => {
  const cls = ClsServiceManager.getClsService();
  if (cls.get(TX_CLIENT_KEY)) {
    return callback();
  } else {
    return (Manager.prismaClient['$root'] as PrismaClient).$transaction(
      async () => {
        return callback();
      },
      {
        isolationLevel,
        timeout: TRANSACTION_TIMEOUT,
      },
    );
  }
};

PrismaTransactional.prismaRoot = null as unknown as PrismaClient;
// Run query with no transaction even if it exists.
Object.defineProperty(PrismaTransactional, 'prismaRoot', {
  get(): PrismaClient {
    return Manager.prismaClient['$root'] as PrismaClient;
  },
});
