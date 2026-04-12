import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/db';
import { loadPageMeta, loadSearchIndex } from '../../../lib/generated/loaders.js';
import { buildResearchBrief } from '../../../lib/knowledge.js';

export async function GET() {
  const jobs = await prisma.researchJob.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  const { topic } = await request.json();
  const [pageMeta, searchIndex] = await Promise.all([loadPageMeta(), loadSearchIndex()]);
  const result = buildResearchBrief({
    topic: String(topic ?? ''),
    pageMeta,
    searchIndex,
  });

  const job = await prisma.researchJob.create({
    data: {
      topic: String(topic ?? ''),
      status: 'completed',
      resultJson: JSON.stringify(result),
    },
  });

  return NextResponse.json(job);
}
