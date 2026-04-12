import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/db';
import { loadPageMeta, loadSearchIndex } from '../../../lib/generated/loaders.js';
import { buildFallbackReply, resolveActivePage, searchKnowledge } from '../../../lib/knowledge.js';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get('threadId');

  if (threadId) {
    const messages = await prisma.chatMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ messages });
  }

  const threads = await prisma.chatThread.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });
  return NextResponse.json({ threads });
}

export async function POST(request: Request) {
  const { threadId, prompt, activePagePath } = await request.json();

  const thread =
    threadId
      ? await prisma.chatThread.findUnique({ where: { id: threadId } })
      : await prisma.chatThread.create({
          data: {
            title: String(prompt ?? 'New chat').slice(0, 40) || 'New chat',
          },
        });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  await prisma.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: String(prompt ?? ''),
    },
  });

  const [pageMeta, searchIndex] = await Promise.all([loadPageMeta(), loadSearchIndex()]);
  const activePage = resolveActivePage({
    pageMeta,
    searchIndex,
    requestedPath: typeof activePagePath === 'string' ? activePagePath : undefined,
  });
  const matches = searchKnowledge({
    searchIndex,
    query: String(prompt ?? ''),
    limit: 3,
  });
  const reply = buildFallbackReply({
    prompt,
    activePage,
    matches,
  });

  await prisma.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'assistant',
      content: reply,
    },
  });

  return NextResponse.json({
    threadId: thread.id,
    reply,
  });
}
