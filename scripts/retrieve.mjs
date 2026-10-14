/* ============================================================
 * scripts/retrieve.mjs
 * 智影工坊 真检索脚本（第 5 周：从占位换成真检索）
 * 功能：加载 data/index/index.json，对用户问题计算 bigram TF-IDF
 *       余弦相似度 + 标签加权，取 Top-K=3；最高相似度低于阈值
 *       0.72 时判定为无命中，返回空列表，不调用模型。
 * 用法：node scripts/retrieve.mjs "你的问题"
 *       node scripts/retrieve.mjs "抖音竖屏分辨率是多少"
 * ============================================================ */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { restoreIndex, knowledgeSearch, PROJECT_ROOT } from "./lib/rag.mjs";

const INDEX_FILE = resolve(PROJECT_ROOT, "data", "index", "index.json");
const THRESHOLD = 0.72;
const TOP_K = 3;

function loadIndex() {
  if (!existsSync(INDEX_FILE)) {
    console.error("[错误] 索引文件不存在，请先运行：node scripts/build_index.mjs");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(INDEX_FILE, "utf-8"));
  return restoreIndex(data.index);
}

function retrieve(query, topK = TOP_K, threshold = THRESHOLD) {
  const runtime = loadIndex();
  const result = knowledgeSearch(query, runtime, topK, threshold);
  return result;
}

// 命令行入口
const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.log("用法：node scripts/retrieve.mjs \"你的问题\"");
  console.log("示例：node scripts/retrieve.mjs \"怎么提炼产品的核心卖点\"");
  process.exit(0);
}

const result = retrieve(query);
const best = result.hits[0];
const bestScore = best ? best.score.toFixed(4) : "—";
const bestCos = best ? best.cosine.toFixed(4) : "—";

console.log(`\n查询：${query}`);
console.log(`阈值：${THRESHOLD}（低于此值视为无命中）`);
console.log(`命中：${result.matched ? "是" : "否（无命中，走兜底）"}`);
console.log(`最高综合分：${bestScore}（余弦相似度 ${bestCos}）`);
console.log(`命中段数：${result.hits.length}\n`);

if (result.hits.length === 0) {
  console.log("[检索] 无候选片段，建议走兜底话术，不调用模型。");
} else {
  result.hits.forEach((h, i) => {
    console.log(`--- 片段 ${i + 1}（综合分 ${h.score.toFixed(4)}，余弦 ${h.cosine.toFixed(4)}）---`);
    console.log(`出处：《${h.chunk.docName}》·${h.chunk.section}`);
    console.log(`标签：${(h.chunk.tags || []).join("、")}`);
    console.log(`内容：${h.chunk.text.slice(0, 120)}${h.chunk.text.length > 120 ? "……" : ""}`);
    console.log();
  });
}

export { retrieve, loadIndex, THRESHOLD, TOP_K };
