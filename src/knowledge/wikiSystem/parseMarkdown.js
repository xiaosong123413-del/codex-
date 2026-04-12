import matter from 'gray-matter';

export function parseMarkdownDocument(rawText) {
  const parsed = matter(rawText);

  return {
    data: parsed.data ?? {},
    content: parsed.content ?? '',
  };
}
