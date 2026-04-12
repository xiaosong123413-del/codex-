import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/db';

export async function POST(request: Request) {
  const { threadId, prompt } = await request.json();

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

  return NextResponse.json({
    threadId: thread.id,
    reply: 'Stub reply from knowledge workspace',
  });
}
