import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continuousRules, defaultConfig } from '../lib/domain';
import { paperFrom } from '../lib/templates';
import {
  makePaperTemplateFile,
  paperImageRefs,
  parsePaperTemplateFile,
  replacePaperImageRefs,
} from '../lib/paper-template-file';

test('外置套卷文件完整携带配置并重建评价图片引用', () => {
  const config = defaultConfig();
  config.dimensions.forEach((dimension) => {
    dimension.rules = continuousRules();
  });
  config.dimensions[0].evaluations[0].image =
    '/api/assets/11111111-1111-4111-8111-111111111111.png';
  const paper = paperFrom(config);
  assert.deepEqual(paperImageRefs(paper), [
    '/api/assets/11111111-1111-4111-8111-111111111111.png',
  ]);
  const bundle = makePaperTemplateFile('学业水平统测｜英语2608', paper, [
    {
      source: '/api/assets/11111111-1111-4111-8111-111111111111.png',
      mediaType: 'image/png',
      base64: 'AA==',
    },
  ]);
  const parsed = parsePaperTemplateFile(JSON.stringify(bundle));
  const restored = replacePaperImageRefs(
    parsed.paper,
    new Map([
      [
        '/api/assets/11111111-1111-4111-8111-111111111111.png',
        '/api/assets/22222222-2222-4222-8222-222222222222.png',
      ],
    ]),
  );
  assert.equal(
    restored.dimensions[0].evaluations[0].image,
    '/api/assets/22222222-2222-4222-8222-222222222222.png',
  );
});

test('外置套卷缺少所引用的图片时拒绝导入', () => {
  const config = defaultConfig();
  config.dimensions.forEach((dimension) => {
    dimension.rules = continuousRules();
  });
  config.dimensions[0].evaluations[0].image =
    '/api/assets/33333333-3333-4333-8333-333333333333.png';
  assert.throws(() =>
    makePaperTemplateFile('不完整套卷', paperFrom(config), []),
  );
});
