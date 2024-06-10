# Prisma Transactional

Package contains @PrismaTransactional decorator that wraps all prisma queries to a single transaction. In case of overlapping several transactions they will be merged.

**Use in production at your own risk.**
A decorator is being actively used on production environment with no issues, but I strictly recommend to wait for a stable release. 


### How to setup in NestJS application

Install a package
```bash
npm i @myfunc/prisma-transactional
```

Patch your PrismaClient with `patchPrismaTx(client, config)`
```tsx
import { patchPrismaTx } from '@myfunc/prisma-transactional'; // Import
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super();
    // Patch and return the substituted version.
    return patchPrismaTx(this, {
      enableLogging: true,
      customLogger: Logger,
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
```
Now you can use `PrismaTransactional`.

### Run example
In [Example application](./example/index.ts) described all possible decorator's use cases.
For running example app, please add .env file and provide DB connection string.

```bash
npm i
npm run dev
```

### How to use the decorator

You can add decorator to any class-method. All queries inside will be wrapped in a single transaction.

On any unhandled error all changed will be rolled back.

**BE CAREFUL when using it, all queries inside transaction will be isolated and can lead to deadlock.**

Example

```tsx
  // Now all queries (including nested queries in methods) will be executed in transaction
  @PrismaTransactional() 
  private async addPoints(userId: string, amount: number) {
    const { balance } = await this.getBalance(userId);
    const newBalance = await this.prisma.user.update({
      select: {
        balance: true,
      },
      where: { id: userId },
      data: { balance: roundBalance(balance + amount) },
    });
    return {
      newBalance
    };
  }
```

To handle success commit you can put the following code anywhere in the code. If there is no transaction, a callback will be executed immediately.

```tsx
PrismaTransactional.onSuccess(() => {
  this.notifyBalanceUpdated(balance!, args._notificationDelay);
});
```

Also, you can add many callbacks. All callbacks are stored in a stack under the hood.

You can execute all in transaction with no decorator.

```tsx
PrismaTransactional.execute(async () => {
  await this.prisma.users.findMany({});
  await this.prisma.users.deleteMany({});
});
```
or
```tsx
const result = await PrismaTransactional.execute(async () => {
  const result = await this.prisma.users.findMany({});
  await this.prisma.users.deleteMany({});
  return result;
});
```

## Plans
- [ ] Get rid of hardcoded values and make them configurable. "TRANSACTION_TIMEOUT"
- [ ] Implement ESLint rule for nested prisma queries that might be unintentionally executed in transaction. That means a developer will be aknowledged about possible transaction wrapping and force him to add an eslint-ignore comment.
- [ ] Add tests.
- [ ] Add express.js examples.