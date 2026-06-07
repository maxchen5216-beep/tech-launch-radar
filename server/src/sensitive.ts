import { join } from "node:path";

/**
 * 敏感词检测。
 * 词库：server/data/sensitive-words.json（分类结构，可直接编辑，重启生效）。
 * 防绕过：检测前将文本归一化——转小写、剔除所有非中文/字母/数字字符，
 * 因此「傻 逼」「傻.逼」「TMD」等变体均会命中原始词条。
 */

const WORDS_FILE = join(import.meta.dir, "..", "data", "sensitive-words.json");

/** 归一化：小写 + 只保留中文/英文/数字 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^一-鿿a-z0-9]/g, "");
}

// 启动时加载词库（词条本身也做归一化，保证与输入同一形态比较）
const raw = JSON.parse(await Bun.file(WORDS_FILE).text()) as Record<string, string[]>;
const WORDS: string[] = [];
for (const [cat, list] of Object.entries(raw)) {
  if (cat.startsWith("_")) continue; // 跳过说明字段
  for (const w of list) {
    const n = normalize(w);
    if (n) WORDS.push(n);
  }
}
console.log(`[sensitive] 敏感词库已加载：${WORDS.length} 条`);

/** 返回文本命中的敏感词列表（空数组 = 通过） */
export function checkSensitive(text: string): string[] {
  const n = normalize(text);
  if (!n) return [];
  return WORDS.filter((w) => n.includes(w));
}
