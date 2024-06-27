import { PrismaClient } from '@prisma/client';
import { ILoggerService, PrismaTransactionalConfig } from './type';
import { ConsoleLogger } from './logger/console-logger';
import { EmptyLogger } from './logger/empty-logger';

class PrismaTransactionalManager {
  private _prismaClient: PrismaClient | null;
  private _logger: ILoggerService = new EmptyLogger();

  setPrismaClient(prismaClient: PrismaClient) {
    this._prismaClient = prismaClient;
  }
  setConfig(config?: PrismaTransactionalConfig) {
    if (config?.enableLogging) {
      this._logger = config.customLogger ?? new ConsoleLogger();
    } else {
      this._logger = new EmptyLogger();
    }
  }

  get prismaClient(): PrismaClient {
    if (!this._prismaClient) {
      throw new Error('PrismaTransactionalManager: Prisma client not set');
    }
    return this._prismaClient;
  }

  get logger(): ILoggerService {
    return this._logger!;
  }
}

export const Manager = new PrismaTransactionalManager();
