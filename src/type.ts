export interface ILoggerService {
  log(message: any, ...optionalParams: any[]): any;
  error(message: any, ...optionalParams: any[]): any;
  warn(message: any, ...optionalParams: any[]): any;
  debug?(message: any, ...optionalParams: any[]): any;
  verbose?(message: any, ...optionalParams: any[]): any;
}

export type PrismaTransactionalConfig = {
  enableLogging?: boolean;
  customLogger?: ILoggerService;
};
