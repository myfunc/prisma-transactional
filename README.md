# @myfunc/prisma-transactional

Package contains @PrismaTransactional decorator that wraps all prisma queries along **the whole call stack** to a single transaction. In case of overlapping several transactions they will be merged.

**Use in production at your own risk.**
A decorator is being actively used on production environment with no issues, but I strictly recommend to wait for a stable release. 

### Installation
```bash
npm i @myfunc/prisma-transactional
```

### Universal setup in node.js application

```typescript
import { PrismaClient } from '@prisma/client';
import { patchPrismaTx } from '@myfunc/prisma-transactional';

const prisma = patchPrismaTx(new PrismaClient());
```

### How to setup in NestJS application

Patch your PrismaClient with `patchPrismaTx(client, config)`
```typescript
import { patchPrismaTx } from '@myfunc/prisma-transactional';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super();
    return patchPrismaTx(this);
  }

  async onModuleInit() {
    await this.$connect();
  }
}
```
Now you can use `PrismaTransactional`.

### Run example
In [Example application](./examples/express/index.ts) described all possible decorator's use cases.
For running example app, please edit DB connection string in the .env file.

```bash
npm i
npm run dev
```

### How to use the decorator

You can add decorator to any class-method. All queries inside will be wrapped in a single transaction.

On any unhandled error all changed will be rolled back.

**BE CAREFUL when using it, all queries inside transaction will be isolated and can lead to deadlock.**

Example

```typescript
export class BalanceService { 
  constructor(private prisma: PrismaService) {}

  // Now all queries (including nested queries in methods) will be executed in transaction
  @PrismaTransactional() 
  async addPoints(userId: string, amount: number) {
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

  async getBalance(userId: string) {
    // Query will be wrapped in transaction if called by addPoints() method.
    const { balance } = await this.prisma.user.findUnique({
        where: {
            id: userId
        },
        select: {
            balance: true
        }
    });
    return balance;
  }
}
```

To handle success commit you can put the following code anywhere in the code. If there is no transaction, a callback will be executed immediately.

```typescript
PrismaTransactional.onSuccess(() => {
  this.notifyBalanceUpdated(balance!, args._notificationDelay);
});
```

Also, you can add many callbacks. All callbacks are stored in a stack under the hood.

You can execute all in transaction with no decorator.
```typescript
await PrismaTransactional.execute(async () => {
  await this.prisma.users.findMany({});
  await this.prisma.users.deleteMany({});
});
```
Or return a result from a success execution.
```typescript
const result = await PrismaTransactional.execute(async () => {
  const result = await this.prisma.users.findMany({});
  await this.prisma.users.deleteMany({});
  return result;
});
```

Execute a query out of current transaction context.
```typescript
@PrismaTransactional() 
  async addPoints(userId: string, amount: number) {
    const { balance } = await this.getBalance(userId);

    // userLog item will be created even if current transaction will be rolled back.
    await PrismaTransactional.prismaRoot.userLog.create(
      { 
        note: `Attempt to add balance for user ${userId} with balance ${balance}`
      }
    );

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

## Plans

- [x] Add `PrismaTransactional.prismaRoot` method for running queries out of transaction context.
- [ ] Add tests.
- [x] Add express.js example.
- [ ] Add nestjs example.
- [ ] Get rid of hardcoded values and make them configurable. "TRANSACTION_TIMEOUT"
- [ ] Safety improvements. As an idea - implement ESLint rule for nested prisma queries that might be unintentionally executed in transaction. That means a developer will be aknowledged about possible transaction wrapping and force him to add an eslint-ignore comment.
- [ ] Clean code.

