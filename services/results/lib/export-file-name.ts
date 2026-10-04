// Default names retain the original roster basename and one export suffix.
export function dimensionCoefficientFileName(sourceFileName: string, includeScoreDetails = true) {
  const original = sourceFileName.split(/[\\/]/).pop() ?? '';
  const printable = Array.from(original, (character) => character.charCodeAt(0) < 32 ? '_' : character).join('');
  const stem = printable.replace(/\.(xlsx?|csv)$/i, '')
    .replace(/(?:[\s_-]*(?:六维系数|六维得分系数|6维得分系数|详细得分))+$/u, '')
    .replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').trim() || '学生名单';
  // Leave room for the suffix within common filesystem filename limits.
  let base = '', byteLength = 0;
  const encoder = new TextEncoder();
  for (const character of stem) {
    const characterBytes = encoder.encode(character).length;
    if (byteLength + characterBytes > 210) break;
    byteLength += characterBytes;
    base += character;
  }
  return `${base}${includeScoreDetails ? '详细得分' : '六维系数'}.xlsx`;
}
