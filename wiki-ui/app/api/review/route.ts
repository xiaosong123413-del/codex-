import { NextResponse } from 'next/server';

import { prisma } from '../../../lib/db';

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
