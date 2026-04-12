import path from 'node:path';

export function resolveWikiSystemConfig(overrides = {}) {
  const wikiRoot =
    overrides.wikiRoot ??
    'C:/Users/Administrator/Desktop/xiaosong的知识库/ai知识库（第二大脑）';

  return {
    wikiRoot,
    systemDir: path.join(wikiRoot, '.wiki-system'),
    allowedCategories: ['人物', '概念', '工具', '项目', '想法', '写作', '来源', '收件箱', '归档'],
  };
}
