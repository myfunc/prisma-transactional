import { PrismaClient } from '@prisma/client/extension';
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
PrismaTransactional.onSuccess = (callback: () => void | Promise<void>) => {
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

// Run callback with isolated PrismaClient with no transaction.
// Only for parameter prismaClient, if other client will be used it will be executed in transaction if exists
PrismaTransactional.executeIsolated = <T>(
  callback: (prismaClient: PrismaClient) => Promise<T>,
): Promise<T> => {
  const prismaRoot = Manager.prismaClient['$root'] as PrismaClient;
  return callback(prismaRoot);
};
