/* ============================================================
 * scripts/build_index.mjs
 * 智影工坊 索引构建脚本（第 5 周新增）
 * 功能：读取 knowledge.data.js 中已切分的知识块，构建 bigram TF-IDF
 *       向量索引，连同元数据（来源文档、章节、块序号）一起存入
 *       data/index/index.json；可重复执行，第二次运行前先清空旧索引。
 * 用法：node scripts/build_index.mjs
 * ============================================================ */

import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadKnowledgeData, buildIndex, PROJECT_ROOT } from "./lib/rag.mjs";

const OUT_DIR = resolve(PROJECT_ROOT, "data", "index");
const OUT_FILE = resolve(OUT_DIR, "index.json");

function build() {
  const t0 = Date.now();

  // 1. 可重复执行：先清空旧索引目录，避免重复入库
  if (existsSync(OUT_DIR)) {
    rmSync(OUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUT_DIR, { recursive: true });

  // 2. 加载已切分的知识块
  const { KNOWLEDGE_CHUNKS: chunks, PLATFORM_SPECS, BANNED_WORDS } = loadKnowledgeData();

  // 3. 构建 TF-IDF 向量索引
  const index = buildIndex(chunks);

  // 4. 连同元数据一起持久化
  const payload = {
    version: "v1",
    builtAt: new Date().toISOString(),
    algorithm: "bigram TF-IDF + 标签加权（与浏览器端 knowledge.js 一致）",
    params: { topK: 3, threshold: 0.72, chunkSize: "300-500字", overlap: "50字" },
    stats: {
      docCount: new Set(chunks.map((c) => c.docName)).size,
      chunkCount: chunks.length,
      platformSpecCount: Object.keys(PLATFORM_SPECS || {}).length,
      bannedWordCount: (BANNED_WORDS || []).length
    },
    docs: [...new Set(chunks.map((c) => c.docName))],
    chunks: chunks.map((c, i) => ({
      id: c.id,
      doc: c.doc,
      docName: c.docName,
      section: c.section,
      tags: c.tags,
      idx: i,
      text: c.text
    })),
    index
  };

  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf-8");

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[索引] 构建完成：${payload.stats.docCount} 个文档，${payload.stats.chunkCount} 个知识块`);
  console.log(`[索引] 平台规范 ${payload.stats.platformSpecCount} 个，违禁词 ${payload.stats.bannedWordCount} 条`);
  console.log(`[索引] 耗时 ${elapsed}s，已存 ${OUT_FILE}`);
  console.log(`[索引] 可重复执行：下次运行将自动清空旧索引后重建`);
}

build();
