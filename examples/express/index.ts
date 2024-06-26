import { Post, Prisma, PrismaClient } from '@prisma/client';
import { patchPrismaTx, PrismaTransactional } from '../../src';

// Init prisma client
const rawPrisma = new PrismaClient({
  log: [
    {
      emit: 'event',
      level: 'query',
    },
    {
      emit: 'stdout',
      level: 'error',
    },
    {
      emit: 'stdout',
      level: 'info',
    },
    {
      emit: 'stdout',
      level: 'warn',
    },
  ],
});
rawPrisma.$on('query', (e) => {
  console.log(`Query: ${e.query} ${e.duration}ms; Params: ${e.params}`);
});

// Apply @PrismaTransactional()
const prisma = patchPrismaTx(rawPrisma, {
  enableLogging: true,
});

// Test code
// Utils
function randomText(length: number) {
  return Math.random().toString(36).slice(-length);
}

function WaitAsync(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Repo
class PostRepository {
  constructor(private prisma: PrismaClient) {}
  createPost(data: Prisma.PostCreateInput) {
    return this.prisma.post.create({ data });
  }

  readPosts(query: Omit<Prisma.PostFindManyArgs, 'select'>): Promise<Post[]> {
    return this.prisma.post.findMany(query);
  }

  deletePost(query: Prisma.PostDeleteArgs) {
    return this.prisma.post.delete(query);
  }

  deleteAll() {
    return this.prisma.post.deleteMany();
  }

  async createRandomPosts(count: number) {
    const postsPromises = Array.from({ length: count }, () =>
      this.prisma.post.create({ data: { title: 'Post ' + randomText(5) } }),
    );
    const posts = await Promise.all(postsPromises);
    return posts;
  }
  editPost(id: number, content: string) {
    return this.prisma.post.update({
      where: { id },
      data: { content },
    });
  }
}

// Service
class PostService {
  constructor(private postRepository: PostRepository) {}

  throwError() {
    throw new Error('Test error');
  }

  async readAllPostsAndCreateOneMerged() {
    const posts = await this.postRepository.readPosts({});
    const summary = posts.reduce((acc, post) => {
      return acc + post.title + ';\n';
    }, '');
    const newPost = await this.postRepository.createPost({
      title: 'New readAllPostsAndCreateOneMerged post',
      content: summary,
    });
    return newPost;
  }

  async deleteAllAndCreateOnePost() {
    await this.postRepository.deleteAll();
    const newPost = await this.postRepository.createPost({
      title: 'New deleteAllAndCreateOnePost post',
    });
    return newPost;
  }

  @PrismaTransactional()
  async txCreate5RandomWait5SecAndSummarize() {
    PrismaTransactional.onSuccess(async () => {
      console.log('txCreate5RandomWait5SecAndSummarize PrismaTransactional.onSuccess');
    });
    await this.postRepository.createRandomPosts(5);
    await WaitAsync(500);
    await this.readAllPostsAndCreateOneMerged();

    return await this.postRepository.readPosts({});
  }

  @PrismaTransactional()
  async txCreate30PostsAndThrow() {
    PrismaTransactional.onSuccess(async () => {
      console.log('txCreate30PostsAndThrow PrismaTransactional.onSuccess');
    });
    const posts = await this.postRepository.createRandomPosts(30);
    await this.postRepository.editPost(posts[0].id, 'edited');
    await WaitAsync(100);

    this.throwError();
  }

  @PrismaTransactional()
  async txCreate5PostsAnd1PostIsolatedAndThrow() {
    PrismaTransactional.onSuccess(async () => {
      console.log('txCreate30PostsAndThrow PrismaTransactional.onSuccess');
    });
    await this.postRepository.createPost({ title: 'Not existing post' });
    await PrismaTransactional.prismaRoot.post.create({ data: { title: 'Isolated post' } });
    await WaitAsync(100);

    PrismaTransactional;

    this.throwError();
  }

  async txReadAllPostsAndCreateOneWithCount() {
    PrismaTransactional.onSuccess(async () => {
      console.log('txReadAllPostsAndCreateOneWithCount PrismaTransactional.onSuccess');
    });

    const posts = await this.postRepository.readPosts({});
    await WaitAsync(250);

    return await this.postRepository.createPost({
      title: 'New txReadAllPostsAndCreateOneMerged post',
      content: `Count: ${posts.length}`,
    });
  }
}

// Main
async function resetDB() {
  await prisma.$queryRaw`TRUNCATE TABLE "Post" RESTART IDENTITY;`;
}

async function main() {
  await resetDB();
  const postRepository = new PostRepository(prisma);
  const postService = new PostService(postRepository);

  const testErrorAction = async () => {
    try {
      await postService.txCreate30PostsAndThrow();
    } catch {}
    return postRepository.readPosts({});
  };

  const testErrorWithIsolatedAction = async () => {
    try {
      await postService.txCreate5PostsAnd1PostIsolatedAndThrow();
    } catch {}
    return postRepository.readPosts({
      where: { OR: [{ title: 'Not existing post' }, { title: 'Isolated post' }] },
    });
  };

  const test1Promise = postService.txCreate5RandomWait5SecAndSummarize();
  const test1Error = await testErrorAction();

  await WaitAsync(20);
  const test2 = await PrismaTransactional.execute(
    async () => await postService.txReadAllPostsAndCreateOneWithCount(),
  );
  const test1 = await test1Promise;
  const test3 = await postService.deleteAllAndCreateOnePost();

  const test2Error = await testErrorWithIsolatedAction();

  console.log({ test1, test2, test3, test1Error, test2Error });
  if (test1.length !== 7) {
    console.error('FAILED: test1.length !== 7');
  }
  if (test2.content !== 'Count: 0') {
    console.error('FAILED: test2.content !== 0');
  }
  if (test3.title !== 'New deleteAllAndCreateOnePost post') {
    console.error('FAILED: test3.content is not correct');
  }
  if (test1Error.length !== 0) {
    console.error('FAILED: test1Error page.length !== 0');
  }
  if (test2Error.length !== 1) {
    console.error('FAILED: test2Error isolated transaction wasnt executed');
  }
  await resetDB();
}

main();
