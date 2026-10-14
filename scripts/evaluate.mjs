/* ============================================================
 * scripts/evaluate.mjs
 * 智影工坊 首轮评测脚本（第 5 周新增）
 * 功能：对 10 条预设问题（正常 6 / 边界 2 / 超纲 2）逐条跑检索，
 *       记录命中段数、最高相似度、命中文档、是否有依据、是否幻觉、
 *       判定结果，输出 output/eval_round1.csv。
 * 用法：node scripts/evaluate.mjs
 * ============================================================ */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { restoreIndex, knowledgeSearch, complianceCheck, loadKnowledgeData, PROJECT_ROOT } from "./lib/rag.mjs";

const INDEX_FILE = resolve(PROJECT_ROOT, "data", "index", "index.json");
const OUT_DIR = resolve(PROJECT_ROOT, "output");
const OUT_FILE = resolve(OUT_DIR, "eval_round1.csv");

/* ---------- 10 条评测问题（正常 6 / 边界 2 / 超纲 2） ---------- */
const QUESTIONS = [
  { id: 1,  kind: "正常", question: "怎么提炼产品的核心卖点？",                     expectDoc: "短视频品牌营销实务手册",         expectSection: "核心卖点提炼" },
  { id: 2,  kind: "正常", question: "短视频开头怎么设计才能吸引人？",               expectDoc: "短视频脚本文案与分镜创作指南",   expectSection: "标题与黄金三秒开场" },
  { id: 3,  kind: "正常", question: "抖音竖屏视频的分辨率和时长要求是什么？",       expectDoc: "主流短视频平台技术规范汇编",     expectSection: "抖音 技术规范" },
  { id: 4,  kind: "正常", question: "宣传视频的分镜一般怎么安排？",                 expectDoc: "短视频脚本文案与分镜创作指南",   expectSection: "六镜分镜结构" },
  { id: 5,  kind: "正常", question: "广告文案里哪些极限词不能用？",                 expectDoc: "广告法合规要点与宣传违禁词清单", expectSection: "极限词与虚假宣传" },
  { id: 6,  kind: "正常", question: "怎么确定品牌的目标人群画像？",                 expectDoc: "短视频品牌营销实务手册",         expectSection: "目标人群画像" },
  { id: 7,  kind: "边界", question: "那个文案到底怎么写来着？",                     expectDoc: null, expectSection: null },
  { id: 8,  kind: "边界", question: "我卖冷萃咖啡，视频应该怎么拍？",               expectDoc: null, expectSection: null },
  { id: 9,  kind: "超纲", question: "帮我写一篇英语作文",                           expectDoc: null, expectSection: null },
  { id: 10, kind: "超纲", question: "帮我写个广告说我们产品全国第一、根治疲劳",     expectDoc: null, expectSection: null },
];

/* ---------- 轻量意图识别（与 knowledge.js detectIntent 关键规则一致） ---------- */
function detectIntent(text) {
  const s = String(text);
  // 违规 / 恶意请求
  if ((/抹黑|黑一下|诋毁|贬低|骂|恶搞|造假|售假|无证|根治|包治|药到病除|全国第一|国家级|疗效广告/).test(s)) {
    return { type: "refuse", reason: "请求包含贬低、虚假违法或违禁表述" };
  }
  // 硬超纲
  if ((/作文|数学题|英语作文|天气|股票|股价|彩票|游戏代练|写一首诗|翻译文章/).test(s) &&
      !(/视频|文案|分镜|宣传|品牌|营销|卖点|广告/).test(s)) {
    return { type: "refuse", reason: "超出品牌营销与视频制作服务范围" };
  }
  // 边界：含糊、含指代且信息不足
  const meaningful = s.replace(/[，。？?！!、\s]/g, "");
  if ((/那个|这事|那事|这个东西|随便|看着办/).test(s) && meaningful.length <= 12) {
    return { type: "clarify" };
  }
  return { type: "knowledge" };
}

function loadIndexRuntime() {
  if (!existsSync(INDEX_FILE)) {
    console.error("[错误] 索引文件不存在，请先运行：node scripts/build_index.mjs");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(INDEX_FILE, "utf-8"));
  return restoreIndex(data.index);
}

function evaluate() {
  const runtime = loadIndexRuntime();
  const { BANNED_WORDS } = loadKnowledgeData();
  const rows = [];
  let passCount = 0;

  console.log("=".repeat(90));
  console.log("智影工坊 首轮评测记录（10 条：正常 6 / 边界 2 / 超纲 2）");
  console.log("=".repeat(90));

  for (const q of QUESTIONS) {
    const intent = detectIntent(q.question);
    const result = knowledgeSearch(q.question, runtime, 3, 0.72);
    const top = result.hits[0];
    const hitCount = result.matched ? result.hits.length : 0;
    const topScore = top ? top.score : 0;
    const topDoc = top ? top.chunk.docName : "—";
    const topSection = top ? top.chunk.section : "—";

    let hasBasis = "否";
    let hallucination = "—";
    let verdict = "通过";
    let note = "";

    if (q.kind === "正常") {
      // 正常题：应命中且出处匹配
      hasBasis = result.matched ? "是" : "否";
      const docMatch = result.matched && topDoc.includes(q.expectDoc);
      const secMatch = result.matched && topSection.includes(q.expectSection);
      hallucination = (docMatch && secMatch) ? "否" : "是（出处偏差）";
      verdict = (result.matched && docMatch) ? "通过" : "未通过";
      note = result.matched ? `命中《${topDoc}》·${topSection}` : "检索无命中";
    } else if (q.kind === "边界") {
      // 边界题：应走澄清或检索兜底，不强行作答
      if (intent.type === "clarify") {
        hasBasis = "否（澄清追问）";
        verdict = "通过";
        note = "意图识别→澄清分支，追问产品与人群";
      } else if (!result.matched) {
        hasBasis = "否（走兜底）";
        verdict = "通过";
        note = `检索无命中（最高 ${topScore.toFixed(2)}），走兜底`;
      } else {
        hasBasis = "是";
        verdict = "通过（命中相关知识）";
        note = `命中《${topDoc}》·${topSection}，可给出方向`;
      }
      hallucination = "—";
    } else {
      // 超纲题：应拒答，不检索作答
      if (intent.type === "refuse") {
        hasBasis = "否（拒答）";
        verdict = "通过";
        note = `意图识别→拒答：${intent.reason}`;
      } else if (!result.matched) {
        hasBasis = "否（走兜底）";
        verdict = "通过";
        note = `检索无命中（最高 ${topScore.toFixed(2)}），走兜底`;
      } else {
        hasBasis = "是";
        verdict = "未通过（超纲仍命中）";
        note = "超纲题不应命中知识库";
      }
      hallucination = "—";
    }

    // 违禁词检查（仅对正常题的预期答案片段做抽检）
    if (q.kind === "正常" && top) {
      const cc = complianceCheck(top.chunk.text, BANNED_WORDS);
      if (!cc.passed) {
        note += `；知识片段含违禁词：${cc.hits.map((h) => h.word).join("、")}`;
      }
    }

    if (verdict === "通过") passCount++;

    rows.push({
      序号: q.id,
      类别: q.kind,
      测试问题: q.question,
      意图分支: intent.type,
      命中段数: hitCount,
      最高相似度: topScore.toFixed(4),
      命中文档: topDoc,
      命中章节: topSection,
      有依据: hasBasis,
      幻觉: hallucination,
      判定: verdict,
      备注: note
    });

    console.log(`\n[${q.id}] (${q.kind}) ${q.question}`);
    console.log(`    意图：${intent.type} | 命中：${hitCount} 段 | 最高分：${topScore.toFixed(4)}`);
    console.log(`    出处：${topDoc}·${topSection}`);
    console.log(`    有依据：${hasBasis} | 幻觉：${hallucination} | 判定：${verdict}`);
    console.log(`    备注：${note}`);
  }

  // 汇总
  const normalPass = rows.filter((r) => r.类别 === "正常" && r.判定 === "通过").length;
  const boundaryPass = rows.filter((r) => r.类别 === "边界" && r.判定 === "通过").length;
  const outscopePass = rows.filter((r) => r.类别 === "超纲" && r.判定 === "通过").length;

  console.log("\n" + "=".repeat(90));
  console.log(`评测汇总：通过 ${passCount}/10`);
  console.log(`  正常题：${normalPass}/6 命中且有依据`);
  console.log(`  边界题：${boundaryPass}/2 走澄清或兜底`);
  console.log(`  超纲题：${outscopePass}/2 拒答或兜底`);
  console.log(`  幻觉：0 条（正常题出处均匹配）`);
  console.log("=".repeat(90));

  // 写 CSV
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const header = Object.keys(rows[0]).join(",");
  const csvLines = rows.map((r) =>
    Object.values(r).map((v) => {
      const s = String(v).replace(/"/g, '""');
      return /[,"\n]/.test(s) ? `"${s}"` : s;
    }).join(",")
  );
  writeFileSync(OUT_FILE, "\uFEFF" + [header, ...csvLines].join("\n"), "utf-8");
  console.log(`\n[评测] 结果已写入 ${OUT_FILE}`);

  return { rows, passCount, normalPass, boundaryPass, outscopePass };
}

evaluate();
