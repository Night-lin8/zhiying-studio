/* ============================================================
 * scripts/lib/rag.mjs
 * 智影工坊 检索增强生成（RAG）共享库 —— Node.js 版
 * 与浏览器端 knowledge.js 的 bigram TF-IDF 余弦 + 标签加权算法保持一致，
 * 供 build_index.mjs / retrieve.mjs / evaluate.mjs 复用。
 * 纯标准库，零外部依赖，可离线运行。
 * ============================================================ */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

/* ---------- 停用字（与 knowledge.js 一致） ---------- */
const STOP_CHARS = new Set(
  ("的 了 是 我 你 他 她 它 们 吗 呢 吧 啊 在 和 与 及 或 一 个 有 就 都 也 很 被 把 让 向 对 为 这 那 之 其 以 于 可 能 要 会 说 去 来 又 再 才").split(" ")
);

/* ---------- 领域概念词（与 knowledge.js CONCEPT_TERMS 一致） ---------- */
const CONCEPT_TERMS = [
  "核心卖点", "卖点", "提炼", "品牌定位", "定位", "差异化", "目标人群", "人群",
  "画像", "受众", "文案", "口播", "标题", "开场", "钩子", "黄金三秒", "号召", "转化", "行动",
  "分镜", "镜头", "景别", "特写", "运镜", "节奏", "时长", "字幕", "配音", "抖音", "快手", "小红书",
  "视频号", "分辨率", "画幅", "竖屏", "横屏", "安全区", "比例", "尺寸", "违禁", "合规", "极限词",
  "广告法", "虚假", "功效", "疗效", "选题", "结构", "场景", "营销", "设计", "fabe", "投流", "出价", "预算",
  /* 第 5 周扩充：新增知识块对应的领域概念词 */
  "完播率", "互动率", "转化率", "复盘", "ROI", "数据指标", "效果分析",
  "品牌故事", "情感", "价值观", "信任", "用户旅程", "触点", "认知", "复购",
  "内容运营", "发布节奏", "更新频率", "账号定位", "矩阵",
  "竞品分析", "对标", "内容拆解",
  "口播节奏", "停顿", "语速", "重音", "情绪",
  "封面", "点击率", "缩略图",
  "BGM", "背景音乐", "音效", "版权", "氛围",
  "评论区", "互动", "置顶", "用户反馈",
  "选题库", "内容规划", "灵感", "日历",
  "B站", "哔哩哔哩",
  "推荐机制", "算法", "流量池", "标签", "冷启动",
  "违规案例", "改写", "示范",
  "美妆", "化妆品", "护肤", "成分",
  "食品", "饮料", "保健", "营养",
  "脚本", "运营", "流量", "涨粉", "数据"
];

/* ---------- 加载 knowledge.data.js（浏览器全局变量适配） ---------- */
export function loadKnowledgeData(dataPath) {
  const p = dataPath || resolve(PROJECT_ROOT, "knowledge.data.js");
  const code = readFileSync(p, "utf-8");
  // 在沙箱中执行，window 为普通对象
  const sandbox = { window: {} };
  // 使用 Function 构造器执行，避免 eval 作用域问题
  const fn = new Function("window", code + "\nreturn { KNOWLEDGE_CHUNKS: window.KNOWLEDGE_CHUNKS, PLATFORM_SPECS: window.PLATFORM_SPECS, BANNED_WORDS: window.BANNED_WORDS };");
  return fn(sandbox.window);
}

/* ---------- 分词：中文 bigram（双倍）+ 关键 unigram + 英文数字 ---------- */
export function tokenize(text) {
  const tokens = [];
  const s = String(text).toLowerCase();
  const han = s.match(/[\u4e00-\u9fa5]/g) || [];
  for (let i = 1; i < han.length; i++) {
    const bg = han[i - 1] + han[i];
    tokens.push(bg, bg);
  }
  for (let i = 0; i < han.length; i++) {
    if (!STOP_CHARS.has(han[i])) tokens.push(han[i]);
  }
  (s.match(/[a-z0-9]+/g) || []).forEach((w) => tokens.push(w));
  return tokens;
}

function termFreq(tokens) {
  const tf = new Map();
  tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  return tf;
}

/* ---------- 构建索引：df + idf + 块向量 ---------- */
export function buildIndex(chunks) {
  const N = chunks.length;
  const df = new Map();
  chunks.forEach((c) => {
    new Set(tokenize(c.text)).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });

  function idf(term) {
    return Math.log((N + 1) / ((df.get(term) || 0) + 0.5)) + 1;
  }

  function vectorize(tokens) {
    const tf = termFreq(tokens);
    const v = new Map();
    tf.forEach((cnt, t) => {
      v.set(t, (1 + Math.log(cnt)) * idf(t));
    });
    let norm = 0;
    v.forEach((x) => (norm += x * x));
    norm = Math.sqrt(norm) || 1;
    v.forEach((x, t) => v.set(t, x / norm));
    return v;
  }

  const chunkVectors = chunks.map((c) => ({
    chunk: c,
    vec: vectorize(tokenize(c.text)),
    textTerms: new Set(tokenize(c.text))
  }));

  // 把 Map 序列化为可 JSON 存储的数组
  return {
    N,
    df: Object.fromEntries(df),
    chunkVectors: chunkVectors.map((cv) => ({
      chunk: cv.chunk,
      vec: Object.fromEntries(cv.vec),
      textTerms: [...cv.textTerms]
    }))
  };
}

/* ---------- 从已构建索引恢复运行时对象 ---------- */
export function restoreIndex(indexData) {
  const df = new Map(Object.entries(indexData.df));
  const N = indexData.N;
  function idf(term) {
    return Math.log((N + 1) / ((df.get(term) || 0) + 0.5)) + 1;
  }
  function vectorize(tokens) {
    const tf = termFreq(tokens);
    const v = new Map();
    tf.forEach((cnt, t) => v.set(t, (1 + Math.log(cnt)) * idf(t)));
    let norm = 0;
    v.forEach((x) => (norm += x * x));
    norm = Math.sqrt(norm) || 1;
    v.forEach((x, t) => v.set(t, x / norm));
    return v;
  }
  const chunkVectors = indexData.chunkVectors.map((cv) => ({
    chunk: cv.chunk,
    vec: new Map(Object.entries(cv.vec)),
    textTerms: new Set(cv.textTerms)
  }));
  return { chunkVectors, idf, vectorize };
}

function cosine(a, b) {
  let dot = 0;
  a.forEach((x, t) => {
    if (b.has(t)) dot += x * b.get(t);
  });
  return dot;
}

/* ---------- 同义词扩展表（第 5 周增强：提升口语化问题的召回率） ---------- */
const SYNONYMS = {
  "开头": ["开场", "钩子", "黄金三秒"],
  "吸引人": ["钩子", "完播率", "开场"],
  "最佳": ["极限词", "合规", "违禁", "广告法"],
  "最好": ["极限词", "合规", "违禁"],
  "最优": ["极限词", "合规"],
  "第一": ["极限词", "合规", "违禁"],
  "能不能用": ["合规", "违禁", "极限词"],
  "可以用吗": ["合规", "违禁", "极限词"],
  "允许吗": ["合规", "违禁", "极限词"],
  "违规": ["合规", "违禁", "广告法"],
  "违法": ["合规", "违禁", "广告法"],
  "拍视频": ["分镜", "脚本", "文案"],
  "怎么做视频": ["分镜", "脚本", "文案"],
  "背景音乐": ["BGM", "音效"],
  "bgm": ["BGM", "音效"],
  "封面图": ["封面", "标题", "点击率"],
  "缩略图": ["封面", "标题"],
  "流量": ["推荐机制", "算法", "运营"],
  "涨粉": ["运营", "内容", "选题"],
  "复盘": ["数据指标", "效果分析"],
  "数据": ["数据指标", "效果分析"],
  "用户画像": ["目标人群", "人群", "画像"],
  "竞品": ["竞品分析", "对标", "差异化"],
  "对标": ["竞品分析", "差异化"],
  "评论": ["评论区", "互动", "运营"],
  "选题": ["选题库", "内容规划", "内容运营"],
  "更新频率": ["内容运营", "发布节奏"],
  "发布时间": ["内容运营", "发布节奏"]
};

/* ---------- 概念抽取：长词优先，移除被包含的短词，并扩展同义词 ---------- */
export function extractConcepts(query) {
  const s = String(query).toLowerCase();
  let hits = CONCEPT_TERMS.filter((t) => s.includes(t.toLowerCase()));
  // 同义词扩展
  Object.entries(SYNONYMS).forEach(([word, concepts]) => {
    if (s.includes(word.toLowerCase())) {
      concepts.forEach((c) => { if (!hits.includes(c)) hits.push(c); });
    }
  });
  hits.sort((a, b) => b.length - a.length);
  const kept = [];
  hits.forEach((h) => {
    if (!kept.some((k) => k.includes(h))) kept.push(h);
  });
  return kept;
}

function buildFocusedQuery(query) {
  const s = String(query).toLowerCase();
  const hits = CONCEPT_TERMS.filter((t) => s.includes(t.toLowerCase()));
  const concept = hits.join(" ");
  if (!concept) return query;
  return `${concept} ${concept} ${query}`;
}

function tagMatch(concept, tag) {
  const c = concept.toLowerCase(), t = tag.toLowerCase();
  return t === c || t.includes(c) || c.includes(t);
}

/* ---------- 检索：标签匹配（主）+ TF-IDF（辅），返回 Top-K ---------- */
export function search(query, indexRuntime, topK = 3) {
  const { chunkVectors, vectorize } = indexRuntime;
  const concepts = extractConcepts(query);
  const qTokens = tokenize(buildFocusedQuery(query));
  const qVec = vectorize(qTokens);
  const scored = chunkVectors.map((cv) => {
    const cos = cosine(qVec, cv.vec);
    const cosScaled = Math.min(cos / 0.34, 1);
    let score;
    if (concepts.length === 0) {
      score = 0.30 * cosScaled;
    } else {
      const tags = cv.chunk.tags || [];
      const primary = tags.slice(0, 2), others = tags.slice(2);
      let pHit = 0, oHit = 0;
      concepts.forEach((c) => {
        if (primary.some((t) => tagMatch(c, t))) pHit++;
        else if (others.some((t) => tagMatch(c, t))) oHit++;
      });
      score = 0.55 + 0.18 * pHit + 0.04 * oHit + 0.30 * cosScaled;
    }
    return { chunk: cv.chunk, cosine: cos, score: Math.min(score, 1) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/* ---------- 知识库检索（含阈值判定） ---------- */
export function knowledgeSearch(query, indexRuntime, topK = 3, threshold = 0.72) {
  const hits = search(query, indexRuntime, topK);
  const top = hits[0];
  if (!top || top.score < threshold) {
    return { matched: false, hits, threshold };
  }
  return { matched: true, hits, threshold };
}

/* ---------- 违禁词校验 ---------- */
export function complianceCheck(text, bannedWords) {
  const hits = [];
  (bannedWords || []).forEach((b) => {
    if (String(text).includes(b.word)) hits.push(b);
  });
  return { passed: hits.length === 0, hits };
}

export { PROJECT_ROOT };
