import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/db';
import { loadAbsorbLog, loadLint } from '../../../lib/generated/loaders.js';
import { buildReviewFeed } from '../../../lib/knowledge.js';

export async function GET() {
  const [persistedItems, lint, absorbLog] = await Promise.all([
    prisma.reviewItem.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 }),
    loadLint(),
    loadAbsorbLog(),
  ]);

  return NextResponse.json({
    items: buildReviewFeed({ lint, absorbLog, persistedItems }),
  });
}

export async function POST(request: Request) {
  const { sourcePath, payloadJson = '{}' } = await request.json();

  const reviewItem = await prisma.reviewItem.create({
    data: {
      sourcePath: String(sourcePath ?? ''),
      payloadJson: typeof payloadJson === 'string' ? payloadJson : JSON.stringify(payloadJson),
    },
  });

  return NextResponse.json(reviewItem);
}

export async function PATCH(request: Request) {
  const { id, status } = await request.json();

  const reviewItem = await prisma.reviewItem.update({
    where: { id: String(id) },
    data: { status: String(status ?? 'resolved') },
  });

  return NextResponse.json(reviewItem);
}
