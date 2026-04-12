import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/db';

export async function POST(request: Request) {
  const { topic } = await request.json();

  const job = await prisma.researchJob.create({
    data: {
      topic: String(topic ?? ''),
      status: 'queued',
    },
  });

  return NextResponse.json(job);
}
