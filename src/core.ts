import { Prisma, PrismaClient } from '@prisma/client/extension';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import { TX_CLIENT_KEY, TX_CLIENT_SUCCESS_CALLBACKS } from './const';
import { Manager } from './manager';
import { PrismaTransactionalConfig } from './type';

// That solution can join transactions.
// Found here https://github.com/prisma/prisma/issues/5729
export { ClsService, ClsServiceManager };

// This function needs to be called after the transaction commit
// You should call this at the point where your transaction successfully commits
function executeSuccessCallbacks(): void {
  const clsService = ClsServiceManager.getClsService();
  const callbacks = clsService.get<(() => void)[]>(TX_CLIENT_SUCCESS_CALLBACKS) || [];
  callbacks.forEach((callback) => {
    try {
      callback();
    } catch (e) {
      Manager.logger.error({
        context: 'Prisma.' + executeSuccessCallbacks.name,
        message: 'Error executing success callback',
        error: e,
      });
    }
  });
  clsService.set(TX_CLIENT_SUCCESS_CALLBACKS, []); // Clear the queue after execution
}

export function patchPrismaTx<T extends PrismaClient>(
  prisma: T,
  config?: PrismaTransactionalConfig,
): T {
  const _prisma = prisma as any;
  const original$transaction = _prisma.$transaction;
  _prisma.$transaction = (...args: unknown[]) => {
    if (typeof args[0] === 'function') {
      const fn = args[0] as (txClient: Prisma.TransactionClient) => Promise<unknown>;
      args[0] = async (txClient: Prisma.TransactionClient) => {
        const clsService = ClsServiceManager.getClsService();

        const maybeExistingTxClient = clsService.get<Prisma.TransactionClient | undefined>(
          TX_CLIENT_KEY,
        );

        if (maybeExistingTxClient) {
          Manager.logger.verbose?.({
            context: 'Prisma.' + patchPrismaTx.name,
            message: 'Return txClient from ALS',
          });

          return fn(maybeExistingTxClient);
        }

        if (clsService.isActive()) {
          // covering this for completeness, should rarely happen
          Manager.logger.warn({
            context: 'Prisma.' + patchPrismaTx.name,
            message: 'Context active without txClient',
          });

          return executeInContext({
            context: clsService,
            txClient,
            fn,
          });
        }

        // this occurs on the top-level
        return clsService.run(async () => {
          return executeInContext({
            context: clsService,
            txClient,
            fn,
          });
        });
      };
    }

    return original$transaction.apply(_prisma, args as any) as any;
  };

  const proxyPrisma = createPrismaProxy(_prisma);
  Manager.setPrismaClient(proxyPrisma);
  Manager.setConfig(config);
  return proxyPrisma as T;
}

type ExecutionParams = {
  context: ClsService;
  txClient: Prisma.TransactionClient;
  fn: (txClient: Prisma.TransactionClient) => Promise<unknown>;
};

async function executeInContext({ context, txClient, fn }: ExecutionParams) {
  context.set(TX_CLIENT_KEY, txClient);

  Manager.logger.verbose?.({
    context: 'Prisma.' + executeInContext.name,
    message: 'Top-level: open context, store txClient and propagate',
  });
  try {
    const result = await fn(txClient);
    executeSuccessCallbacks();
    return result;
  } finally {
    context.set(TX_CLIENT_KEY, undefined);

    Manager.logger.verbose?.({
      context: 'Prisma.' + executeInContext.name,
      message: 'Top-level: ALS context reset',
    });
  }
}

function createPrismaProxy<T extends PrismaClient>(target: T): T {
  const _target = target as any;
  return new Proxy(_target, {
    get(_, prop, receiver) {
      // provide an undocumented escape hatch to access the root PrismaClient and start top-level transactions
      if (prop === '$root') {
        Manager.logger.verbose?.({
          context: 'Prisma.' + createPrismaProxy.name,
          message: '[Proxy] Accessing root Prisma',
        });

        return _target;
      }

      const maybeExistingTxClient = ClsServiceManager.getClsService().get<
        Prisma.TransactionClient | undefined
      >(TX_CLIENT_KEY);

      const prisma = maybeExistingTxClient ?? _target;

      if (prop === '$transaction' && maybeExistingTxClient && typeof _target[prop] === 'function') {
        Manager.logger.verbose?.({
          context: 'Prisma.' + createPrismaProxy.name,
          message: '[Proxy] $transaction called on a txClient, continue nesting it',
        });

        return function (...args: unknown[]) {
          // grab the callback of the native "prisma.$transaction(callback, options)" invocation and invoke it with the txClient from the ALS
          if (typeof args[0] === 'function') {
            return args[0](maybeExistingTxClient);
          } else if (args[0] instanceof Array) {
            Manager.logger.warn({
              context: 'Prisma.' + createPrismaProxy.name,
              message:
                'Nested $transaction called with an array argument, it is probably works out of transaction',
            });
          } else {
            throw new Error('prisma.$transaction called with a non-function argument');
          }
        };
      }
      return Reflect.get(prisma, prop, receiver);
    },
    set(_, prop, newValue, receiver) {
      if (prop === '$transaction') {
        Manager.logger.warn({
          context: 'Prisma.' + createPrismaProxy.name,
          message: `Please don't spy on $transaction.`,
        });
        return false;
      }

      const maybeExistingTxClient = ClsServiceManager.getClsService().get<
        Prisma.TransactionClient | undefined
      >(TX_CLIENT_KEY);

      const prisma = maybeExistingTxClient ?? _target;
      return Reflect.set(prisma, prop, newValue, receiver);
    },
    defineProperty(_, prop, attributes) {
      const maybeExistingTxClient = ClsServiceManager.getClsService().get<
        Prisma.TransactionClient | undefined
      >(TX_CLIENT_KEY);

      const prisma = maybeExistingTxClient ?? _target;
      return Reflect.defineProperty(prisma, prop, attributes);
    },
  }) as T;
}
