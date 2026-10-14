"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const BACKGROUNDS = [
  { id: "studio", name: "纯净空间", src: "assets/backgrounds/studio.png" },
  { id: "tech", name: "科技蓝调", src: "assets/backgrounds/tech.png" },
  { id: "nature", name: "自然生机", src: "assets/backgrounds/nature.png" },
  { id: "retail", name: "活力卖场", src: "assets/backgrounds/retail.png" }
];

const PROVIDERS = {
  openai: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini"
  },
  deepseek: {
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat"
  },
  qwen: {
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus"
  }
};

const MOTIONS = [
  { id: "still", name: "静止" },
  { id: "pushIn", name: "推近" },
  { id: "pullOut", name: "拉远" },
  { id: "panLeft", name: "左移" },
  { id: "panRight", name: "右移" },
  { id: "tiltUp", name: "上移" },
  { id: "tiltDown", name: "下移" }
];

const WORKSPACE_KEY = "brandflow.workspace.v1";

const state = {
  direction: "product",
  generated: null,
  foregroundImage: null,
  foregroundData: null,
  sampleColor: null,
  cutoutCanvas: null,
  cutoutOffset: { x: 0, y: 0 },
  selectedBackgroundId: "studio",
  backgroundCache: new Map(),
  backgroundNames: new Map(),
  compositeCanvas: null,
  selectedShot: 0,
  playback: null,
  recording: false,
  recorder: null,
  apiConfigured: false,
  imageConfigured: false,
  onlineEnabled: true,
  hasApiCredentials: false,
  offlineVariant: 0,
  cutoutTimer: 0,
  workspaceTimer: 0
};

const elements = {};

function cacheElements() {
  elements.navItems = $$(".workflow-item");
  elements.panels = $$(".step-panel");
  elements.networkStatus = $("#networkStatus");
  elements.networkStatusText = $("#networkStatusText");
  elements.briefForm = $("#briefForm");
  elements.generateButton = $("#generateButton");
  elements.directionControl = $("#directionControl");
  elements.directionInput = $("#direction");
  elements.scriptPreview = $("#scriptPreview");
  elements.storyboardList = $("#storyboardList");
  elements.storyboardCount = $("#storyboardCount");
  elements.regenerateButton = $("#regenerateButton");
  elements.copyScriptButton = $("#copyScriptButton");
  elements.downloadMarkdownButton = $("#downloadMarkdownButton");
  elements.foregroundDrop = $("#foregroundDrop");
  elements.foregroundInput = $("#foregroundInput");
  elements.sourceCanvas = $("#sourceCanvas");
  elements.composeEmpty = $("#composeEmpty");
  elements.canvasStage = $("#canvasStage");
  elements.canvasHint = $("#canvasHint");
  elements.canvasSize = $("#canvasSize");
  elements.cutoutMethod = $("#cutoutMethod");
  elements.tolerance = $("#tolerance");
  elements.toleranceValue = $("#toleranceValue");
  elements.feather = $("#feather");
  elements.featherValue = $("#featherValue");
  elements.backgroundInput = $("#backgroundInput");
  elements.backgroundGrid = $("#backgroundGrid");
  elements.downloadCutoutButton = $("#downloadCutoutButton");
  elements.applyCompositeButton = $("#applyCompositeButton");
  elements.previewCanvas = $("#previewCanvas");
  elements.playButton = $("#playButton");
  elements.timeline = $("#timeline");
  elements.timelineProgress = $("#timelineProgress");
  elements.timecode = $("#timecode");
  elements.voiceButton = $("#voiceButton");
  elements.downloadSrtButton = $("#downloadSrtButton");
  elements.exportVideoButton = $("#exportVideoButton");
  elements.summaryRatio = $("#summaryRatio");
  elements.summaryDuration = $("#summaryDuration");
  elements.summaryShots = $("#summaryShots");
  elements.subtitleToggle = $("#subtitleToggle");
  elements.autoAdvanceToggle = $("#autoAdvanceToggle");
  elements.settingsButton = $("#settingsButton");
  elements.settingsModal = $("#settingsModal");
  elements.closeSettingsButton = $("#closeSettingsButton");
  elements.providerSelect = $("#providerSelect");
  elements.apiEndpoint = $("#apiEndpoint");
  elements.apiModel = $("#apiModel");
  elements.apiKey = $("#apiKey");
  elements.imageEndpoint = $("#imageEndpoint");
  elements.imageModel = $("#imageModel");
  elements.imageSize = $("#imageSize");
  elements.imageEnhancementToggle = $("#imageEnhancementToggle");
  elements.settingsStatus = $("#settingsStatus");
  elements.onlineEnhancementToggle = $("#onlineEnhancementToggle");
  elements.testApiButton = $("#testApiButton");
  elements.saveSettingsButton = $("#saveSettingsButton");
  elements.toastRegion = $("#toastRegion");
  elements.aiBriefButton = $("#aiBriefButton");
  elements.clipStart = $("#clipStart");
  elements.clipEnd = $("#clipEnd");
  elements.resetClipButton = $("#resetClipButton");
  elements.playClipButton = $("#playClipButton");
  elements.exportClipButton = $("#exportClipButton");
  elements.prevShotButton = $("#prevShotButton");
  elements.nextShotButton = $("#nextShotButton");
  elements.shotScene = $("#shotScene");
  elements.shotSubtitle = $("#shotSubtitle");
  elements.shotDuration = $("#shotDuration");
  elements.shotMotion = $("#shotMotion");
}

function getBrief() {
  return {
    brandName: $("#brandName").value.trim() || "未命名品牌",
    productName: $("#productName").value.trim() || "新品",
    category: $("#category").value,
    description: $("#description").value.trim() || "为品质生活打造的创新产品。",
    audience: $("#audience").value.trim() || "追求品质的年轻消费者",
    sellingPoints: $("#sellingPoints").value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    tone: $("#tone").value,
    direction: state.direction,
    aspectRatio: $("#aspectRatio").value
  };
}

function getWorkspaceSnapshot() {
  const brief = getBrief();
  const generated = state.generated ? { ...state.generated } : null;
  if (generated) {
    delete generated.brief;
  }
  return {
    version: 1,
    direction: state.direction,
    offlineVariant: state.offlineVariant,
    brief,
    generated
  };
}

function saveWorkspace() {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(getWorkspaceSnapshot()));
    if (window.Auth && window.Auth.isLoggedIn) {
      window.Auth.scheduleSync(WORKSPACE_KEY);
    }
  } catch (error) {
    console.warn("Workspace autosave skipped:", error);
  }
}

function scheduleWorkspaceSave(delay = 350) {
  clearTimeout(state.workspaceTimer);
  state.workspaceTimer = window.setTimeout(saveWorkspace, delay);
}

function restoreWorkspace() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) {
      return false;
    }
    const snapshot = JSON.parse(raw);
    if (!snapshot?.brief || typeof snapshot.brief !== "object") {
      return false;
    }
    state.offlineVariant = Number.isInteger(snapshot.offlineVariant)
      ? snapshot.offlineVariant
      : Number.isInteger(snapshot.generated?.variant)
        ? snapshot.generated.variant
        : Date.now() % 997;

    const brief = snapshot.brief;
    const textFields = { brandName: "brandName", productName: "productName", category: "category", description: "description", audience: "audience", tone: "tone", aspectRatio: "aspectRatio" };
    Object.entries(textFields).forEach(([id, key]) => {
      if (typeof brief[key] === "string") {
        document.getElementById(id).value = brief[key];
      }
    });
    if (Array.isArray(brief.sellingPoints)) {
      document.getElementById("sellingPoints").value = brief.sellingPoints.join("\n");
    }

    const direction = ["product", "lifestyle", "story"].includes(snapshot.direction) ? snapshot.direction : "product";
    state.direction = direction;
    elements.directionInput.value = direction;
    $$("[data-direction]", elements.directionControl).forEach((node) => {
      node.classList.toggle("active", node.dataset.direction === direction);
    });

    if (snapshot.generated && Array.isArray(snapshot.generated.shots) && snapshot.generated.shots.length) {
      const shots = snapshot.generated.shots.map((shot, index) => ({
        id: index + 1,
        scene: String(shot.scene || `Shot ${index + 1}`),
        subtitle: String(shot.subtitle || ""),
        narration: String(shot.narration || shot.subtitle || ""),
        duration: Number(shot.duration) || 4.5,
        background: BACKGROUNDS.some((item) => item.id === shot.background) ? shot.background : BACKGROUNDS[index % BACKGROUNDS.length].id,
        transition: String(shot.transition || "")
        ,motion: normalizeMotion(shot.motion)
      }));
      state.generated = {
        ...snapshot.generated,
        brief: { ...brief, direction },
        sellingPoints: Array.isArray(snapshot.generated.sellingPoints) ? snapshot.generated.sellingPoints : (Array.isArray(brief.sellingPoints) ? brief.sellingPoints : []),
        narrations: Array.isArray(snapshot.generated.narrations) ? snapshot.generated.narrations : shots.map((shot) => shot.narration),
        shots
      };
      return true;
    }
    return false;
  } catch (error) {
    console.warn("Workspace restore skipped:", error);
    return false;
  }
}

function showStep(stepId) {
  $$(".step-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${stepId}`);
  });
  $$(".workflow-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.stepTarget === stepId);
  });
}

function showToast(message, type = "info", duration = 3200) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), duration);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pick(items, seed) {
  let value = seed % Math.max(items.length, 1);
  return items[value];
}

function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function getToneProfile(tone) {
  const profiles = {
    vitality: {
      title: ["年轻就要不一样", "把喜欢装进日常", "这一刻，鲜活开场"],
      call: ["即刻拥有", "今天就开始", "把新鲜感带回家"],
      descriptor: ["轻盈", "鲜活", "自在", "元气"]
    },
    tech: {
      title: ["科技，让体验更简单", "为未来重新设计", "每一次升级都值得期待"],
      call: ["探索更多", "开启新体验", "让智能触手可及"],
      descriptor: ["智能", "高效", "精准", "未来感"]
    },
    premium: {
      title: ["质感，藏在每个细节", "从容生活的高级答案", "值得认真选择的品质"],
      call: ["优雅拥有", "尊享体验", "让品质成为日常"],
      descriptor: ["精致", "从容", "经典", "纯粹"]
    },
    promo: {
      title: ["好价不必等", "现在入手更划算", "限时惊喜已上线"],
      call: ["立即抢购", "马上入手", "点击了解更多"],
      descriptor: ["超值", "实惠", "惊喜", "热卖"]
    }
  };
  return profiles[tone] || profiles.vitality;
}

function getDirectionProfile(direction) {
  const profiles = {
    product: {
      opening: "让视线聚焦，感受产品的每一个细节。",
      scenes: ["产品特写", "质感细节", "核心卖点", "使用瞬间", "人群共鸣", "品牌收束"],
      closing: "把选择交给体验，把惊喜留在每一次使用。"
    },
    lifestyle: {
      opening: "生活需要一点从容，也需要一点新鲜感。",
      scenes: ["清晨场景", "通勤场景", "工作间隙", "好友相聚", "产品融入", "品牌收束"],
      closing: "在熟悉的日常里，遇见恰到好处的美好。"
    },
    story: {
      opening: "好产品背后，往往有一个认真打磨的故事。",
      scenes: ["初心开场", "工艺溯源", "细节坚持", "用户见证", "价值升华", "品牌愿景"],
      closing: "时间会证明，认真值得被看见。"
    }
  };
  return profiles[direction] || profiles.product;
}

function offlineGenerate(brief, variant = 0) {
  const seed = hashText(`${brief.brandName}${brief.productName}${brief.description}`) + variant;
  const tone = getToneProfile(brief.tone);
  const direction = getDirectionProfile(brief.direction);
  const points = brief.sellingPoints.length ? brief.sellingPoints : ["品质可靠", "设计出众", "体验出色"];
  const descriptor = pick(tone.descriptor, seed + variant);
  const title = `${brief.brandName}｜${brief.productName}：${pick(tone.title, seed + variant)}`;
  const tagline = `${brief.category}新选择，${pick(tone.call, seed + variant * 2)}。`;
  const summary = `${brief.productName}面向${brief.audience}，以${descriptor}体验回应品质需求。${brief.description}`;

  const narrations = [
    `${direction.opening}`,
    `${brief.brandName}带来${brief.productName}，专为${brief.audience}打造。`,
    points.slice(0, 3).map((point, index) => `${index + 1}. ${point}`).join(" "),
    `${brief.description}`,
    `不只有好产品，更有贴心的细节与可靠的体验。`,
    `${direction.closing} ${brief.brandName}，${pick(tone.call, seed + 3)}。`
  ];

  const sceneDurations = [4.2, 5.0, 5.4, 4.8, 4.2, 4.6];
  const backgrounds = ["studio", "tech", "nature", "retail", "studio", "tech"];
  const shots = direction.scenes.map((scene, index) => ({
    id: index + 1,
    scene,
    subtitle: narrations[index],
    narration: narrations[index],
    duration: sceneDurations[index],
    background: backgrounds[index],
    transition: index === direction.scenes.length - 1 ? "淡出" : index === 0 ? "淡入" : "渐隐",
    motion: ["pushIn", "panRight", "tiltUp", "pullOut", "panLeft", "tiltDown"][index % 6]
  }));

  return {
    mode: "offline",
    variant,
    title,
    tagline,
    summary,
    sellingPoints: points,
    narrations,
    shots,
    brief
  };
}

async function generateWithApi(brief, settings) {
  const systemPrompt = [
    "你是品牌宣传视频策划智能体。",
    "根据用户输入生成中文宣传脚本。",
    "只返回 JSON，不要 Markdown 代码块，不要附加解释。",
    'JSON 结构：{"title":"","tagline":"","summary":"","sellingPoints":[],"narrations":[""],"shots":[{"scene":"","subtitle":"","narration":"","duration":4.5,"background":"studio","transition":"渐隐","motion":"still"}]}',
    "必须包含 6 个分镜。duration 为 4 到 6 秒。background 只能是 studio/tech/nature/retail。motion 只能是 still/pushIn/pullOut/panLeft/panRight/tiltUp/tiltDown。"
  ].join("\n");
  const userPrompt = JSON.stringify(brief, null, 2);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(settings.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.75,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`API ${response.status}: ${detail.slice(0, 160)}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  const jsonStart = stripped.indexOf("{");
  const jsonEnd = stripped.lastIndexOf("}");
  const cleaned = jsonStart >= 0 && jsonEnd > jsonStart
    ? stripped.slice(jsonStart, jsonEnd + 1)
    : stripped;
  const parsed = JSON.parse(cleaned);
  parsed.mode = "online";
  parsed.brief = brief;
  parsed.shots = parsed.shots.slice(0, 6).map((shot, index) => ({
    ...shot,
    id: index + 1,
    background: BACKGROUNDS.some((item) => item.id === shot.background)
      ? shot.background
      : BACKGROUNDS[index % BACKGROUNDS.length].id,
    transition: shot.transition || "渐隐",
    motion: normalizeMotion(shot.motion)
  }));
  return parsed;
}

async function requestChatCompletion(settings, messages, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 25000;
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(settings.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model,
        temperature: options.temperature ?? 0.75,
        messages
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`API ${response.status}: ${detail.slice(0, 180)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseJsonLoose(raw) {
  const stripped = String(raw || "").replace(/```(?:json)?/gi, "").trim();
  const jsonStart = stripped.indexOf("{");
  const jsonEnd = stripped.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    return JSON.parse(stripped.slice(jsonStart, jsonEnd + 1));
  }
  return JSON.parse(stripped);
}

function setSelectByText(select, value) {
  if (!value) return;
  const options = Array.from(select.options);
  const match = options.find((option) => option.value === value || option.textContent.trim() === value);
  if (match) select.value = match.value;
}

function normalizeTone(value) {
  const map = {
    "年轻活力": "vitality",
    "活力": "vitality",
    "科技未来": "tech",
    "科技": "tech",
    "高端沉稳": "premium",
    "高端": "premium",
    "促销直给": "promo",
    "促销": "promo"
  };
  const tone = map[value] || value;
  return ["vitality", "tech", "premium", "promo"].includes(tone) ? tone : "vitality";
}

function normalizeDirection(value) {
  const map = {
    "产品视觉": "product",
    "产品": "product",
    "生活场景": "lifestyle",
    "生活": "lifestyle",
    "品牌故事": "story",
    "故事": "story"
  };
  const direction = map[value] || value;
  return ["product", "lifestyle", "story"].includes(direction) ? direction : "product";
}

function normalizeAspect(value) {
  return ["16:9", "9:16", "1:1"].includes(value) ? value : "16:9";
}

function normalizeMotion(value) {
  const map = {
    "静止": "still",
    "推近": "pushIn",
    "拉远": "pullOut",
    "左移": "panLeft",
    "右移": "panRight",
    "上移": "tiltUp",
    "下移": "tiltDown"
  };
  const motion = map[value] || value;
  return MOTIONS.some((item) => item.id === motion) ? motion : "still";
}

function fillBriefFromSummary(summary = {}) {
  if (summary.brandName) $("#brandName").value = String(summary.brandName).slice(0, 30);
  if (summary.productName) $("#productName").value = String(summary.productName).slice(0, 40);
  if (summary.description) $("#description").value = String(summary.description).slice(0, 240);
  if (summary.audience) $("#audience").value = String(summary.audience).slice(0, 80);
  if (Array.isArray(summary.sellingPoints) && summary.sellingPoints.length) {
    $("#sellingPoints").value = summary.sellingPoints.slice(0, 6).map(String).join("\n");
  }
  if (summary.category) setSelectByText($("#category"), String(summary.category));
  setSelectByText($("#tone"), normalizeTone(summary.tone));
  const direction = normalizeDirection(summary.direction);
  state.direction = direction;
  elements.directionInput.value = direction;
  $$("[data-direction]", elements.directionControl).forEach((node) => {
    node.classList.toggle("active", node.dataset.direction === direction);
  });
  setSelectByText($("#aspectRatio"), normalizeAspect(summary.aspectRatio));
  scheduleWorkspaceSave();
  return getBrief();
}

function normalizeGeneratedContent(content, brief) {
  const shots = (Array.isArray(content.shots) ? content.shots : []).slice(0, 6).map((shot, index) => ({
    id: index + 1,
    scene: String(shot.scene || `Shot ${index + 1}`),
    subtitle: String(shot.subtitle || ""),
    narration: String(shot.narration || shot.subtitle || ""),
    duration: Number(shot.duration) || 4.5,
    background: BACKGROUNDS.some((item) => item.id === shot.background) ? shot.background : BACKGROUNDS[index % BACKGROUNDS.length].id,
    transition: String(shot.transition || "渐隐"),
    motion: normalizeMotion(shot.motion)
  }));
  const sellingPoints = Array.isArray(content.sellingPoints) && content.sellingPoints.length
    ? content.sellingPoints.slice(0, 6).map(String)
    : (Array.isArray(brief.sellingPoints) ? brief.sellingPoints : ["品质可靠", "设计出众"]);
  const narrations = Array.isArray(content.narrations) && content.narrations.length
    ? content.narrations.map(String)
    : shots.map((shot) => shot.narration);
  return {
    ...content,
    mode: content.mode || "online",
    brief,
    sellingPoints,
    narrations,
    shots
  };
}

function applyConversationResult(summary = {}, content = null) {
  const brief = fillBriefFromSummary(summary);
  if (!content || !Array.isArray(content.shots) || !content.shots.length) {
    content = offlineGenerate(brief, state.offlineVariant);
  }
  content = normalizeGeneratedContent(content, brief);
  state.generated = content;
  state.selectedShot = 0;
  saveWorkspace();
  renderGeneratedContent(content);
  return content;
}

async function generatePosterCanvas(summary = {}, content = null) {
  const formBrief = getBrief();
  const brief = {
    ...formBrief,
    ...(summary || {}),
    sellingPoints: Array.isArray(summary?.sellingPoints) && summary.sellingPoints.length
      ? summary.sellingPoints
      : formBrief.sellingPoints
  };
  const aspect = normalizeAspect(summary?.aspectRatio || brief.aspectRatio);
  const dims = aspect === "9:16"
    ? { width: 1080, height: 1920 }
    : aspect === "1:1"
      ? { width: 1080, height: 1080 }
      : { width: 1920, height: 1080 };
  const canvas = document.createElement("canvas");
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext("2d");

  let remoteImage = null;
  if (state.imageConfigured) {
    try {
      remoteImage = await requestGeneratedPosterImage(brief, canvas.width, canvas.height);
    } catch (error) {
      console.warn("AI poster image failed, fallback to stock/gradient:", error);
    }
  }
  if (!remoteImage) {
    try {
      const keyword = [brief.productName, brief.brandName, brief.category]
        .filter(Boolean)
        .join(" ") || "品牌宣传";
      remoteImage = await fetchPosterBackground(keyword, canvas.width, canvas.height);
    } catch (error) {
      console.warn("Remote poster background failed, use local gradient:", error);
    }
  }

  if (remoteImage) {
    ctx.fillStyle = "#10151c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawCover(ctx, remoteImage, canvas.width, canvas.height);
  } else {
    const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bg.addColorStop(0, "#0b1220");
    bg.addColorStop(0.5, "#0f3a40");
    bg.addColorStop(1, "#0f766e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.save();
  ctx.globalAlpha = remoteImage ? 0.06 : 0.16;
  ctx.fillStyle = "#5eead4";
  ctx.beginPath();
  ctx.arc(canvas.width * 0.88, canvas.height * 0.16, Math.min(canvas.width, canvas.height) * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(canvas.width * 0.1, canvas.height * 0.88, Math.min(canvas.width, canvas.height) * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const artScale = Math.min(canvas.width, canvas.height);
  const warmWash = ctx.createRadialGradient(canvas.width * 0.16, canvas.height * 0.84, 0, canvas.width * 0.16, canvas.height * 0.84, artScale * 0.72);
  warmWash.addColorStop(0, "rgba(230, 192, 123, 0.18)");
  warmWash.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = warmWash;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalAlpha = remoteImage ? 0.06 : 0.16;
  ctx.strokeStyle = "#99f6e4";
  ctx.lineWidth = Math.max(1.5, artScale * 0.002);
  for (let ring = 1; ring <= 4; ring += 1) {
    ctx.beginPath();
    ctx.arc(canvas.width * 0.9, canvas.height * 0.12, artScale * (0.08 + ring * 0.07), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = remoteImage ? 0.04 : 0.07;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let line = -5; line <= 5; line += 1) {
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.64 + line * artScale * 0.09, -canvas.height * 0.15);
    ctx.lineTo(canvas.width * 0.64 + line * artScale * 0.09 + canvas.height * 0.8, canvas.height * 1.15);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = remoteImage ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.16)";
  const dotStep = Math.max(30, Math.round(artScale * 0.035));
  for (let y = 0; y < canvas.height; y += dotStep) {
    for (let x = 0; x < canvas.width; x += dotStep) {
      if (((x / dotStep + y / dotStep) & 1) === 0) continue;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, artScale * 0.0016), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  const overlay = ctx.createLinearGradient(0, canvas.height * 0.4, 0, canvas.height);
  if (remoteImage) {
    const scrim = ctx.createLinearGradient(0, 0, 0, canvas.height);
    scrim.addColorStop(0, "rgba(7, 11, 16, 0.34)");
    scrim.addColorStop(1, "rgba(7, 11, 16, 0.82)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    overlay.addColorStop(0, "rgba(7, 11, 16, 0)");
    overlay.addColorStop(1, "rgba(7, 11, 16, 0.72)");
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const base = dims.width > dims.height ? dims.height : dims.width;
  const title = String(brief.productName || brief.brandName || "品牌新品");
  const brand = String(brief.brandName || "我的品牌");
  const tagline = content?.tagline || `${brief.category || "品质"}新选择，为${brief.audience || "你"}而生。`;
  const points = (content?.sellingPoints?.length ? content.sellingPoints : brief.sellingPoints || []).slice(0, 4).map(String);

  ctx.textBaseline = "alphabetic";
  const category = String(brief.category || "品质生活");
  ctx.fillStyle = "#2dd4bf";
  ctx.fillRect(canvas.width * 0.06, canvas.height * 0.155, Math.max(40, base * 0.04), Math.max(5, base * 0.006));
  ctx.fillStyle = "#99f6e4";
  ctx.font = `700 ${Math.max(15, Math.round(base * 0.021))}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(category, canvas.width * 0.06, canvas.height * 0.155 + Math.max(18, Math.round(base * 0.026)));

  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 12;
  ctx.font = `700 ${Math.max(34, Math.round(base * 0.06))}px "Microsoft YaHei", sans-serif`;
  const titleLines = wrapText(ctx, title, canvas.width * 0.72);
  titleLines.slice(0, 2).forEach((line, index) => {
    ctx.fillText(line, canvas.width * 0.06, canvas.height * 0.25 + index * base * 0.075);
  });

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#d7f7f1";
  ctx.font = `600 ${Math.max(22, Math.round(base * 0.032))}px "Microsoft YaHei", sans-serif`;
  const tagLines = wrapText(ctx, tagline, canvas.width * 0.78);
  tagLines.slice(0, 2).forEach((line, index) => {
    ctx.fillText(line, canvas.width * 0.06, canvas.height * 0.48 + index * base * 0.042);
  });

  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.max(20, Math.round(base * 0.028))}px "Microsoft YaHei", sans-serif`;
  points.forEach((point, index) => {
    const y = canvas.height * 0.64 + index * base * 0.046;
    if (y > canvas.height * 0.9) return;
    ctx.fillStyle = "#2dd4bf";
    ctx.fillRect(canvas.width * 0.06, y - base * 0.018, base * 0.012, base * 0.012);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(point.slice(0, 22), canvas.width * 0.06 + base * 0.024, y);
  });

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `500 ${Math.max(16, Math.round(base * 0.024))}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(brand, canvas.width * 0.06, canvas.height * 0.94);

  return canvas;
}

function loadRemoteImage(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    let settled = false;
    let timer = null;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      resolve(result);
    };
    timer = window.setTimeout(() => settle(null), timeoutMs);
    image.onload = () => settle(image);
    image.onerror = () => settle(null);
    image.src = url;
  });
}

async function fetchPosterBackground(keyword, width, height) {
  const normalized = String(keyword || "brand").trim().replace(/\s+/g, "-") || "brand";
  const seed = encodeURIComponent(normalized);
  const query = encodeURIComponent(String(keyword || "brand"));
  const urls = [
    `https://picsum.photos/seed/${seed}/${width}/${height}`,
    `https://loremflickr.com/${width}/${height}/${query}`
  ];
  for (const url of urls) {
    const image = await loadRemoteImage(url, 5000);
    if (image) return image;
  }
  return null;
}

function imageFromDataUrl(dataUrl, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    let timer = null;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      resolve(result);
    };
    timer = window.setTimeout(() => settle(null), timeoutMs);
    image.onload = () => settle(image);
    image.onerror = () => settle(null);
    image.src = dataUrl;
  });
}

function buildImagePrompt(brief, shot = null, aspect = "16:9") {
  const toneText = {
    vitality: "bright, energetic, youthful, clean",
    tech: "futuristic, precise, cyan and cool metallic tones",
    premium: "luxurious, restrained, high-end editorial lighting",
    promo: "bold, high contrast, retail-ready, direct"
  }[brief.tone] || "professional brand advertising";
  const directionText = {
    product: "product hero shot with the item clearly visible",
    lifestyle: "realistic lifestyle scene showing a person using the product naturally",
    story: "cinematic brand-story scene with an emotional, narrative mood"
  }[brief.direction] || "brand advertising scene";
  const shotText = shot?.scene ? `, scene description: ${shot.scene}` : "";
  const points = Array.isArray(brief.sellingPoints) && brief.sellingPoints.length
    ? brief.sellingPoints.slice(0, 4).join("; ")
    : "premium quality and thoughtful design";
  return [
    `Professional advertising image for brand ${brief.brandName || "Brand"} and product ${brief.productName || "Product"}.`,
    `Product category: ${brief.category || "consumer goods"}. Description: ${brief.description || "modern innovative product"}.`,
    `Target audience: ${brief.audience || "young quality-conscious consumers"}. Key selling points: ${points}.`,
    `Visual style: ${toneText}. Creative direction: ${directionText}${shotText}.`,
    `Aspect ratio ${aspect}. High resolution, realistic texture, cinematic composition, balanced lighting, no text, no logo, no watermark.`
  ].join(" ");
}

async function requestImageGeneration(settings, prompt, size) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  const payload = {
    model: settings.imageModel,
    prompt,
    n: 1,
    response_format: "b64_json"
  };
  if (size && size !== "auto") payload.size = size;
  let response;
  try {
    response = await fetch(settings.imageEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify(payload)
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Image API ${response.status}: ${detail.slice(0, 180)}`);
  }
  const data = await response.json();
  const first = data?.data?.[0] || data?.images?.[0] || null;
  return first?.b64_json || first?.b64Json || first?.url || first?.image_url || "";
}

async function requestGeneratedPosterImage(brief, width, height) {
  const settings = readSettings();
  if (!state.imageConfigured) return null;
  const aspect = width > height ? "16:9" : width < height ? "9:16" : "1:1";
  const prompt = buildImagePrompt(brief, null, aspect);
  const raw = await requestImageGeneration(settings, prompt, settings.imageSize);
  if (!raw) return null;
  if (raw.startsWith("data:")) return imageFromDataUrl(raw);
  if (/^https?:\/\//i.test(raw)) return loadRemoteImage(raw, 12000);
  return imageFromDataUrl(`data:image/png;base64,${raw}`);
}

function motionName(motion) {
  return (MOTIONS.find((item) => item.id === motion) || MOTIONS[0]).name;
}

async function generateBriefWithAi() {
  const settings = readSettings();
  if (!state.apiConfigured) {
    showToast("请先配置在线模型接口", "error");
    elements.settingsButton.click();
    return;
  }

  const brief = getBrief();
  elements.aiBriefButton.disabled = true;
  try {
    const systemPrompt = [
      "你是品牌宣传创意策划助手。",
      "根据现有品牌和产品信息，补全简洁的中文创意输入。",
      "只返回 JSON，不要 Markdown。",
      '结构：{"productName":"","category":"","description":"","audience":"","sellingPoints":[""],"tone":"","direction":""}',
      "sellingPoints 返回 3 到 5 条。tone 只能是 年轻活力/科技未来/高端沉稳/促销直给。direction 只能是 产品视觉/生活场景/品牌故事。"
    ].join("\n");
    const raw = await requestChatCompletion(settings, [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(brief, null, 2) }
    ], { temperature: 0.7 });
    const parsed = parseJsonLoose(raw);

    if (parsed.productName) $("#productName").value = String(parsed.productName).slice(0, 40);
    if (parsed.description) $("#description").value = String(parsed.description).slice(0, 240);
    if (parsed.audience) $("#audience").value = String(parsed.audience).slice(0, 80);
    if (Array.isArray(parsed.sellingPoints) && parsed.sellingPoints.length) {
      $("#sellingPoints").value = parsed.sellingPoints.slice(0, 5).map(String).join("\n");
    }
    if (parsed.category) setSelectByText($("#category"), String(parsed.category));
    if (parsed.tone) setSelectByText($("#tone"), String(parsed.tone));
    if (parsed.direction) {
      const directionMap = { "产品视觉": "product", "生活场景": "lifestyle", "品牌故事": "story" };
      const direction = directionMap[parsed.direction] || parsed.direction;
      if (["product", "lifestyle", "story"].includes(direction)) {
        state.direction = direction;
        $("#direction").value = direction;
        $$("[data-direction]", $("#directionControl")).forEach((node) => {
          node.classList.toggle("active", node.dataset.direction === direction);
        });
      }
    }
    scheduleWorkspaceSave();
    showToast("已用在线模型补全创意，可继续编辑后生成内容", "success");
  } catch (error) {
    console.error(error);
    showToast(`创意生成失败：${error.message}`, "error", 5000);
  } finally {
    elements.aiBriefButton.disabled = false;
  }
}

async function generateContent({ showPanel = true, forceNewVariant = false } = {}) {
  if (!elements.briefForm.reportValidity()) {
    return null;
  }

  const brief = getBrief();
  const offlineVariant = forceNewVariant ? state.offlineVariant + 1 : state.offlineVariant;
  elements.generateButton.disabled = true;
  elements.regenerateButton.disabled = true;
  elements.networkStatus.classList.add("is-busy");
  elements.networkStatusText.textContent = "生成中";

  try {
    const settings = readSettings();
    let result = null;

    if (state.apiConfigured && navigator.onLine) {
      try {
        result = await generateWithApi(brief, settings);
        showToast("已使用在线模型生成脚本", "success");
      } catch (error) {
        console.warn("Online generation failed, falling back offline:", error);
        result = offlineGenerate(brief, offlineVariant);
        state.offlineVariant = offlineVariant;
        showToast("在线生成不可用，已自动切换到离线引擎");
      }
    } else {
      result = offlineGenerate(brief, offlineVariant);
      state.offlineVariant = offlineVariant;
      if (state.apiConfigured) {
        showToast("当前离线，已使用离线规则引擎");
      }
    }

    state.generated = result;
    state.selectedShot = 0;
    saveWorkspace();
    renderGeneratedContent(result);
    if (showPanel) {
      showStep("content");
    }
    return result;
  } catch (error) {
    console.error(error);
    showToast(`生成失败：${error.message}`, "error", 5000);
  } finally {
    elements.generateButton.disabled = false;
    elements.regenerateButton.disabled = false;
    elements.networkStatus.classList.remove("is-busy");
    updateNetworkStatus();
  }
}

function renderGeneratedContent(content) {
  elements.scriptPreview.innerHTML = `
    <h2>${escapeHtml(content.title)}</h2>
    <p><strong>${escapeHtml(content.tagline)}</strong></p>
    <p>${escapeHtml(content.summary)}</p>
    <h3>核心卖点</h3>
    ${content.sellingPoints.map((point) => `<p>• ${escapeHtml(point)}</p>`).join("")}
    <h3>口播文案</h3>
    ${content.narrations.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    <h3>分镜与字幕</h3>
    ${content.shots.map((shot) => `<p>${shot.id}. ${escapeHtml(shot.scene)}｜${escapeHtml(shot.subtitle)}｜${escapeHtml(motionName(shot.motion))}</p>`).join("")}
  `;

  elements.storyboardCount.textContent = `${content.shots.length} 镜`;
  elements.storyboardList.innerHTML = content.shots.map((shot, index) => `
    <article class="storyboard-card ${index === state.selectedShot ? "active" : ""}" data-shot-index="${index}">
      <div class="shot-thumb">${String(shot.id).padStart(2, "0")}</div>
      <div class="storyboard-copy">
        <strong>${escapeHtml(shot.scene)}</strong>
        <p>${escapeHtml(shot.subtitle)}</p>
        <span>${shot.duration.toFixed(1)}s · ${escapeHtml(shot.transition)} · ${escapeHtml(motionName(shot.motion))}</span>
      </div>
    </article>
  `).join("");

  $$(".storyboard-card", elements.storyboardList).forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedShot = Number(card.dataset.shotIndex);
      $$(".storyboard-card", elements.storyboardList).forEach((item) => {
        item.classList.toggle("active", item === card);
      });
      renderPreviewFrame();
      renderShotEditor();
      showStep("export");
    });
  });

  updateExportSummary();
  renderPreviewFrame();
}

function updateExportSummary() {
  if (!state.generated) {
    return;
  }
  const total = state.generated.shots.reduce((sum, shot) => sum + shot.duration, 0);
  elements.summaryRatio.textContent = state.generated.brief.aspectRatio;
  elements.summaryDuration.textContent = `${Math.round(total)} 秒`;
  elements.summaryShots.textContent = `${state.generated.shots.length} 镜`;
  elements.clipStart.min = "0";
  elements.clipStart.max = total.toFixed(1);
  elements.clipEnd.min = "0";
  elements.clipEnd.max = total.toFixed(1);
  if (!elements.clipStart.value) elements.clipStart.value = "0";
  if (!elements.clipEnd.value) elements.clipEnd.value = total.toFixed(1);
  normalizeClipRange();
  renderShotEditor();
}

function selectedShotObject() {
  if (!state.generated?.shots?.length) return null;
  const index = Math.max(0, Math.min(state.selectedShot, state.generated.shots.length - 1));
  state.selectedShot = index;
  return state.generated.shots[index];
}

function renderShotEditor() {
  const shot = selectedShotObject();
  if (!shot) return;
  elements.shotScene.value = shot.scene;
  elements.shotSubtitle.value = shot.subtitle;
  elements.shotDuration.value = Number(shot.duration || 4.5).toFixed(1);
  elements.shotMotion.value = normalizeMotion(shot.motion);
}

function commitShotEditor() {
  const shot = selectedShotObject();
  if (!shot) return;
  shot.scene = String(elements.shotScene.value || "Shot").slice(0, 60);
  shot.subtitle = String(elements.shotSubtitle.value || "").slice(0, 160);
  shot.duration = Math.max(0.5, Number(elements.shotDuration.value) || 4.5);
  shot.motion = normalizeMotion(elements.shotMotion.value);
  updateExportSummary();
  renderPreviewFrame();
  scheduleWorkspaceSave();
}

function navigateShot(delta) {
  if (!state.generated?.shots?.length) return;
  const count = state.generated.shots.length;
  state.selectedShot = (state.selectedShot + delta + count) % count;
  renderShotEditor();
  renderPreviewFrame();
}

function getCanvasDimensions() {
  const ratios = {
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
    "1:1": { width: 960, height: 960 }
  };
  const ratio = state.generated?.brief.aspectRatio || "16:9";
  return ratios[ratio] || ratios["16:9"];
}

function resizePreviewCanvas() {
  const dimensions = getCanvasDimensions();
  elements.previewCanvas.width = dimensions.width;
  elements.previewCanvas.height = dimensions.height;
}

async function getBackground(sourceId) {
  if (!sourceId) {
    return null;
  }
  if (state.backgroundCache.has(sourceId)) {
    return state.backgroundCache.get(sourceId);
  }
  const entry = BACKGROUNDS.find((item) => item.id === sourceId);
  if (!entry) {
    return null;
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      state.backgroundCache.set(sourceId, image);
      resolve(image);
    };
    image.onerror = reject;
    image.src = entry.src;
  });
}

function drawCover(ctx, image, width, height) {
  if (!image) {
    return;
  }
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "high";
  }
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

function drawMotionCover(ctx, image, width, height, motion = "still", progress = 0) {
  if (!image) {
    return;
  }
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "high";
  }
  const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  const eased = clamped * clamped * (3 - 2 * clamped);
  const baseScale = Math.max(width / image.width, height / image.height);
  let zoom = baseScale;
  if (motion === "pushIn") zoom = baseScale * (1 + eased * 0.12);
  if (motion === "pullOut") zoom = baseScale * (1.12 - eased * 0.12);
  if (["panLeft", "panRight", "tiltUp", "tiltDown"].includes(motion)) zoom = baseScale * 1.08;
  const drawWidth = image.width * zoom;
  const drawHeight = image.height * zoom;
  let x = (width - drawWidth) / 2;
  let y = (height - drawHeight) / 2;
  const panX = Math.max(0, drawWidth - width);
  const panY = Math.max(0, drawHeight - height);
  if (motion === "panLeft") x -= panX * eased;
  if (motion === "panRight") x += panX * eased;
  if (motion === "tiltUp") y -= panY * eased;
  if (motion === "tiltDown") y += panY * eased;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const character of text) {
    const test = line + character;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = character;
    } else {
      line = test;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

async function renderPreviewFrame(progress = 0, shotIndex = null) {
  if (!state.generated) {
    return;
  }
  resizePreviewCanvas();
  const ctx = elements.previewCanvas.getContext("2d");
  const { width, height } = elements.previewCanvas;
  const resolvedShotIndex = Number.isInteger(shotIndex) ? shotIndex : state.selectedShot;
  state.selectedShot = Math.max(0, Math.min(resolvedShotIndex, state.generated.shots.length - 1));
  const shot = state.generated.shots[state.selectedShot] || state.generated.shots[0];
  const backgroundId = state.compositeCanvas ? shot.background : shot.background;
  const background = await getBackground(backgroundId);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#10151c";
  ctx.fillRect(0, 0, width, height);
  drawMotionCover(ctx, background, width, height, shot.motion, progress);

  const overlay = ctx.createLinearGradient(0, height * 0.48, 0, height);
  overlay.addColorStop(0, "rgba(7, 11, 16, 0)");
  overlay.addColorStop(1, "rgba(7, 11, 16, 0.76)");
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, width, height);

  if (state.compositeCanvas) {
    const availableHeight = height * (width > height ? 0.62 : 0.42);
    const scale = Math.min(width * 0.42 / state.compositeCanvas.width, availableHeight / state.compositeCanvas.height);
    const drawWidth = state.compositeCanvas.width * scale;
    const drawHeight = state.compositeCanvas.height * scale;
    const x = width - drawWidth - width * 0.07;
    const y = height * 0.18;
    ctx.drawImage(state.compositeCanvas, x, y, drawWidth, drawHeight);
  }

  const baseSize = width > height ? width : height;
  ctx.fillStyle = "#0dd3b8";
  ctx.fillRect(width * 0.06, height * 0.13, 52, 5);

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.max(28, Math.round(baseSize * 0.045))}px "Microsoft YaHei", sans-serif`;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 10;
  const titleLines = wrapText(ctx, state.generated.title, width * 0.55);
  titleLines.slice(0, 2).forEach((line, index) => {
    ctx.fillText(line, width * 0.06, height * 0.19 + index * baseSize * 0.055);
  });

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#d7f7f1";
  ctx.font = `600 ${Math.max(16, Math.round(baseSize * 0.023))}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(`镜头 ${String(shot.id).padStart(2, "0")} · ${shot.scene} · ${motionName(shot.motion)}`, width * 0.06, height * 0.72);

  if (elements.subtitleToggle.checked) {
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.max(20, Math.round(baseSize * 0.028))}px "Microsoft YaHei", sans-serif`;
    const subtitleLines = wrapText(ctx, shot.subtitle, width * 0.78);
    subtitleLines.slice(0, 2).forEach((line, index) => {
      ctx.fillText(line, width * 0.06, height - 62 + index * baseSize * 0.04);
    });
  }

  const duration = shot.duration || 4.5;
  elements.timecode.textContent = `00:00 / ${formatTime(duration)}`;
  elements.timelineProgress.style.width = "0%";
}

function formatTime(seconds) {
  const rounded = Math.max(0, Math.round(seconds * 10) / 10);
  const minutes = Math.floor(rounded / 60);
  const remainder = Math.floor(rounded % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function drawCompositeToBackground(canvas, backgroundId) {
  const ctx = canvas.getContext("2d");
  const backgroundEntry = BACKGROUNDS.find((item) => item.id === backgroundId);
  const background = state.backgroundCache.get(backgroundId);
  drawCover(ctx, background, canvas.width, canvas.height);
  return backgroundEntry;
}

function setCanvasHint(message) {
  elements.canvasHint.textContent = message;
}

async function decodeImageFile(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (error) {
      console.warn("createImageBitmap failed, using FileReader:", error);
    }
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Unable to read image"));
    image.src = dataUrl;
  });
  return image;
}

async function loadForeground(file) {
  if (!file || !file.type.startsWith("image/")) {
    return;
  }

  try {
    const image = await decodeImageFile(file);

    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    elements.sourceCanvas.width = width;
    elements.sourceCanvas.height = height;
    const ctx = elements.sourceCanvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    state.foregroundImage = image;
    state.foregroundData = ctx.getImageData(0, 0, width, height);
    state.sampleColor = null;
    elements.composeEmpty.remove();
    elements.sourceCanvas.hidden = false;
    elements.canvasSize.textContent = `${width} × ${height}`;
    setCanvasHint("请点击图片中的背景区域取样");
    processCutout();
    showToast("素材已载入", "success");
  } catch (error) {
    console.error(error);
    showToast(`素材载入失败：${error.message}`, "error");
  }
}

function colorDistance(a, b) {
  const red = a[0] - b[0];
  const green = a[1] - b[1];
  const blue = a[2] - b[2];
  const redMean = (a[0] + b[0]) / 2;
  const redWeight = 2 + redMean / 256;
  const greenWeight = 4;
  const blueWeight = 2 + (255 - redMean) / 256;
  return Math.sqrt(
    redWeight * red * red + greenWeight * green * green + blueWeight * blue * blue
  );
}

function getDefaultSample(data, width, height) {
  const samples = [];
  const step = Math.max(4, Math.floor(Math.max(width, height) / 40));
  for (let x = 0; x < width; x += step) {
    samples.push([data[(x * 4)], data[(x * 4) + 1], data[(x * 4) + 2]]);
    const bottom = ((height - 1) * width + x) * 4;
    samples.push([data[bottom], data[bottom + 1], data[bottom + 2]]);
  }
  for (let y = 0; y < height; y += step) {
    samples.push([data[(y * width * 4)], data[(y * width * 4) + 1], data[(y * width * 4) + 2]]);
    const right = ((y * width + width - 1) * 4);
    samples.push([data[right], data[right + 1], data[right + 2]]);
  }

  if (!samples.length) {
    return [255, 255, 255];
  }

  const buckets = new Map();
  samples.forEach((color) => {
    const key = color.map((channel) => Math.round(channel / 16) * 16).join(",");
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });
  const dominant = Array.from(buckets.entries()).sort((a, b) => b[1] - a[1])[0][0];
  return dominant.split(",").map(Number);
}

function createMask(data, width, height) {
  const method = elements.cutoutMethod.value;
  const tolerance = Number(elements.tolerance.value);
  const feather = Number(elements.feather.value);
  const mask = new Float32Array(width * height);
  let targetColor = null;

  if (method === "green") {
    targetColor = [0, 255, 0];
  } else if (method === "blue") {
    targetColor = [0, 0, 255];
  } else if (method === "light") {
    targetColor = [255, 255, 255];
  } else if (state.sampleColor) {
    targetColor = state.sampleColor;
  } else {
    targetColor = getDefaultSample(data, width, height);
  }

  const threshold = method === "green" || method === "blue"
    ? tolerance * 2.5
    : tolerance * 1.35;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const color = [data[offset], data[offset + 1], data[offset + 2]];
    const distance = colorDistance(color, targetColor);
    const backgroundAlpha = Math.max(0, Math.min(1, 1 - Math.max(0, distance - threshold * 0.35) / (threshold * 0.65)));
    mask[index] = backgroundAlpha;
  }

  if (method === "green" || method === "blue") {
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (method === "green" && green > red * 1.05 && green > blue * 0.92) {
        const spill = Math.min(80, Math.max(0, green - Math.max(red, blue) * 0.75));
        data[offset] = Math.min(255, red + spill * 0.55);
        data[offset + 2] = Math.min(255, blue + spill * 0.5);
      }
      if (method === "blue" && blue > red * 1.05 && blue > green * 0.9) {
        const spill = Math.min(70, Math.max(0, blue - Math.max(red, green) * 0.7));
        data[offset] = Math.min(255, red + spill * 0.45);
        data[offset + 1] = Math.min(255, green + spill * 0.45);
      }
    }
  }

  return blurMask(mask, width, height, feather);
}

function blurMask(mask, width, height, radius) {
  const passes = Math.min(6, Math.max(0, Math.ceil(radius / 2)));
  let source = Float32Array.from(mask);
  let target = new Float32Array(source.length);
  const kernel = Math.max(1, radius);

  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let x = -kernel; x <= kernel; x += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x));
        sum += source[row + sampleX];
      }
      const divisor = kernel * 2 + 1;
      for (let x = 0; x < width; x += 1) {
        target[row + x] = sum / divisor;
        const leaving = Math.max(0, x - kernel);
        const entering = Math.min(width - 1, x + kernel + 1);
        sum += source[row + entering] - source[row + leaving];
      }
    }

    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -kernel; y <= kernel; y += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y));
        sum += target[sampleY * width + x];
      }
      const divisor = kernel * 2 + 1;
      for (let y = 0; y < height; y += 1) {
        source[y * width + x] = sum / divisor;
        const leaving = Math.max(0, y - kernel);
        const entering = Math.min(height - 1, y + kernel + 1);
        sum += target[entering * width + x] - target[leaving * width + x];
      }
    }
  }

  return source;
}

function scheduleCutout(delay = 60) {
  clearTimeout(state.cutoutTimer);
  state.cutoutTimer = window.setTimeout(processCutout, delay);
}

function cropToContent(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[((y * width) + x) * 4 + 3] > 10) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0) {
    return { data, width, height, offsetX: 0, offsetY: 0 };
  }

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const cropped = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) {
    const sourceRow = ((minY + y) * width + minX) * 4;
    const targetRow = y * cropWidth * 4;
    cropped.set(data.subarray(sourceRow, sourceRow + cropWidth * 4), targetRow);
  }
  return { data: cropped, width: cropWidth, height: cropHeight, offsetX: minX, offsetY: minY };
}

function processCutout() {
  if (!state.foregroundData) {
    return;
  }

  const { width, height } = elements.sourceCanvas;
  const data = new Uint8ClampedArray(state.foregroundData.data);
  const mask = createMask(data, width, height);

  for (let index = 0; index < width * height; index += 1) {
    data[index * 4 + 3] = Math.round((1 - mask[index]) * 255);
  }

  if (!state.cutoutCanvas) {
    state.cutoutCanvas = document.createElement("canvas");
    state.cutoutCanvas.id = "cutoutCanvas";
    elements.canvasStage.appendChild(state.cutoutCanvas);
  }
  const cropped = cropToContent(data, width, height);
  state.cutoutOffset = { x: cropped.offsetX, y: cropped.offsetY };
  state.cutoutCanvas.width = cropped.width;
  state.cutoutCanvas.height = cropped.height;
  const ctx = state.cutoutCanvas.getContext("2d");
  ctx.putImageData(new ImageData(cropped.data, cropped.width, cropped.height), 0, 0);
  elements.sourceCanvas.hidden = true;
}

function updateCompositeCanvas() {
  const dimensions = getCanvasDimensions();
  if (!state.cutoutCanvas || !state.cutoutCanvas.width) {
    return null;
  }

  if (!state.compositeCanvas) {
    state.compositeCanvas = document.createElement("canvas");
  }
  state.compositeCanvas.width = dimensions.width;
  state.compositeCanvas.height = dimensions.height;
  const ctx = state.compositeCanvas.getContext("2d");
  const background = state.backgroundCache.get(state.selectedBackgroundId);
  if (background) {
    drawCover(ctx, background, dimensions.width, dimensions.height);
  } else {
    ctx.fillStyle = "#e8edf2";
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);
  }

  const availableHeight = dimensions.height * 0.7;
  const availableWidth = dimensions.width * 0.64;
  const scale = Math.min(availableWidth / state.cutoutCanvas.width, availableHeight / state.cutoutCanvas.height);
  const drawWidth = state.cutoutCanvas.width * scale;
  const drawHeight = state.cutoutCanvas.height * scale;
  const x = (dimensions.width - drawWidth) / 2;
  const y = (dimensions.height - drawHeight) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(state.cutoutCanvas, x, y, drawWidth, drawHeight);
  return state.compositeCanvas;
}

async function renderBackgroundLibrary() {
  elements.backgroundGrid.innerHTML = "";
  const entries = [...BACKGROUNDS];
  const custom = Array.from(state.backgroundCache.entries())
    .filter(([id]) => id.startsWith("custom:"));

  const renderEntry = (entry) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `background-item ${entry.id === state.selectedBackgroundId ? "active" : ""}`;
    const image = document.createElement("img");
    image.src = entry.src;
    image.alt = entry.name;
    item.appendChild(image);
    const label = document.createElement("span");
    label.textContent = entry.name;
    item.appendChild(label);
    item.addEventListener("click", () => {
      state.selectedBackgroundId = entry.id;
      $$(".background-item", elements.backgroundGrid).forEach((node) => {
        node.classList.toggle("active", node === item);
      });
      if (state.foregroundData) {
        updateCompositeCanvas();
        renderPreviewFrame();
      }
    });
    return item;
  };

  await Promise.all(entries.map((entry) => getBackground(entry.id).catch(() => null)));
  entries.forEach((entry) => elements.backgroundGrid.appendChild(renderEntry(entry)));

  for (const [id, image] of custom) {
    const url = image.src;
    const index = custom.findIndex(([customId]) => customId === id);
    const name = state.backgroundNames.get(id) || `自定义 ${index + 1}`;
    const entry = { id, name, src: url };
    elements.backgroundGrid.appendChild(renderEntry(entry));
  }
}

async function loadCustomBackground(file) {
  if (!file || !file.type.startsWith("image/")) {
    return;
  }
  try {
    const url = URL.createObjectURL(file);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("无法读取背景图片"));
      image.src = url;
    });
    const id = `custom:${Date.now()}`;
    state.backgroundCache.set(id, image);
    state.selectedBackgroundId = id;
    await renderBackgroundLibrary();
    if (state.foregroundData) {
      updateCompositeCanvas();
      renderPreviewFrame();
    }
    showToast("自定义背景已添加", "success");
  } catch (error) {
    showToast(`背景添加失败：${error.message}`, "error");
  }
}

async function addGeneratedBackground(dataUrl, name = "AI 配图") {
  if (!dataUrl) return null;
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("无法读取生成图片"));
    image.src = dataUrl;
  });
  const id = `custom:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.backgroundCache.set(id, image);
  state.backgroundNames.set(id, name);
  state.selectedBackgroundId = id;
  await renderBackgroundLibrary();
  return id;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadDataUrl(dataUrl, filename) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function downloadText(text, filename, type = "text/plain") {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

function buildMarkdown(content) {
  const lines = [
    `# ${content.title}`,
    "",
    `> ${content.tagline}`,
    "",
    content.summary,
    "",
    "## 核心卖点",
    ...content.sellingPoints.map((point) => `- ${point}`),
    "",
    "## 口播文案",
    ...content.narrations.map((line) => `${line}`),
    "",
    "## 分镜脚本",
    "",
    "| 镜头 | 场景 | 字幕/口播 | 时长 | 背景 | 转场 | 运镜 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...content.shots.map((shot) => `| ${shot.id} | ${shot.scene} | ${shot.subtitle} | ${shot.duration.toFixed(1)}s | ${shot.background} | ${shot.transition} | ${motionName(shot.motion)} |`),
    "",
    `> 生成模式：${content.mode === "online" ? "在线模型增强" : "完全离线规则引擎"}`
  ];
  return lines.join("\n");
}

function srtTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function buildSrt(content) {
  let cursor = 0;
  return content.shots.map((shot, index) => {
    const start = cursor;
    const end = start + shot.duration;
    cursor = end;
    return [
      index + 1,
      `${srtTime(start)} --> ${srtTime(end)}`,
      shot.subtitle,
      ""
    ].join("\n");
  }).join("\n");
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast("已复制到剪贴板", "success"),
      () => showToast("复制失败", "error")
    );
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast("已复制到剪贴板", "success");
  }
}

function speakCurrentScript() {
  if (!state.generated) {
    return;
  }
  if (!("speechSynthesis" in window)) {
    showToast("当前浏览器不支持本地配音预览", "error");
    return;
  }
  window.speechSynthesis.cancel();
  const text = state.generated.narrations.join("。");
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.96;
  utterance.pitch = 1.02;
  utterance.volume = 1;
  const voices = window.speechSynthesis.getVoices();
  const chineseVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("zh"));
  if (chineseVoice) {
    utterance.voice = chineseVoice;
  }
  window.speechSynthesis.speak(utterance);
  showToast("正在试听本地配音");
}

function stopPlayback() {
  if (state.playback?.raf) {
    cancelAnimationFrame(state.playback.raf);
  }
  if (state.playback?.timer) {
    clearTimeout(state.playback.timer);
  }
  state.playback = null;
  window.speechSynthesis.cancel();
  elements.playButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m8 5 12 7-12 7V5Z"/></svg>
  `;
}

async function stopRecording() {
  if (state.recorder && state.recorder.state !== "inactive") {
    state.recorder.stop();
  }
}

function readClipRange(total) {
  const max = Math.max(0, total);
  const start = Math.max(0, Number(elements.clipStart.value) || 0);
  const end = Math.min(max, Number(elements.clipEnd.value) || max);
  return { start, end, enabled: end > start && end - start < max - 0.05 };
}

function resetClipRange() {
  const total = state.generated?.shots.reduce((sum, shot) => sum + shot.duration, 0) || 0;
  elements.clipStart.value = "0";
  elements.clipEnd.value = total.toFixed(1);
  showToast("剪辑区间已重置为整段");
}

function normalizeClipRange() {
  const total = state.generated?.shots.reduce((sum, shot) => sum + shot.duration, 0) || 0;
  const start = Math.max(0, Number(elements.clipStart.value) || 0);
  const end = Math.min(total, Number(elements.clipEnd.value) || total);
  elements.clipStart.value = Math.min(start, end).toFixed(1);
  elements.clipEnd.value = Math.max(start, end).toFixed(1);
}

async function startPlayback({ record = false, clip = false } = {}) {
  if (!state.generated) {
    showToast("请先生成宣传脚本", "error");
    return;
  }
  if (state.playback) {
    stopPlayback();
    stopRecording();
    return;
  }

  await renderPreviewFrame();
  const allShots = state.generated.shots;
  const fullDuration = allShots.reduce((sum, shot) => sum + shot.duration, 0);
  const clipRange = clip ? readClipRange(fullDuration) : { start: 0, end: fullDuration, enabled: false };
  const clipActive = clip && clipRange.enabled;
  const autoAdvance = clipActive ? true : elements.autoAdvanceToggle.checked;
  const playbackShots = autoAdvance ? allShots : [allShots[state.selectedShot]];
  const clipOffset = clipActive ? clipRange.start * 1000 : 0;
  const playbackDuration = clipActive ? clipRange.end - clipRange.start : playbackShots.reduce((sum, shot) => sum + shot.duration, 0);
  const totalDuration = playbackDuration * 1000;
  const startTime = performance.now();
  const chunks = [];
  let recorder = null;
  let recording = record;

  if (record) {
    if (!("MediaRecorder" in window) || !elements.previewCanvas.captureStream) {
      showToast("当前浏览器不支持视频录制，请使用新版 Edge 或 Chrome", "error", 5000);
      return;
    }
    try {
      const stream = elements.previewCanvas.captureStream(30);
      recorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType(), videoBitsPerSecond: 6000000 });
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "video/webm";
        downloadBlob(new Blob(chunks, { type: mimeType }), clipActive ? "brand-video-clip.webm" : "brand-video.webm");
        showToast(clipActive ? "剪辑片段已导出" : "视频已导出", "success");
      };
      recorder.onerror = () => {
        showToast("视频录制失败", "error");
      };
      recorder.start(250);
      state.recorder = recorder;
      showToast(clipActive ? "正在录制剪辑片段" : "正在录制，播放结束后自动导出");
    } catch (error) {
      console.error(error);
      showToast(`无法开始录制：${error.message}`, "error");
      recording = false;
    }
  }

  elements.playButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
  `;

  const frame = async (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / totalDuration);
    const position = clipOffset + elapsed;
    let cursor = 0;
    let shotIndex = 0;
    if (autoAdvance) {
      for (let index = 0; index < allShots.length; index += 1) {
        const nextCursor = cursor + allShots[index].duration * 1000;
        if (position < nextCursor || index === allShots.length - 1) {
          shotIndex = index;
          break;
        }
        cursor = nextCursor;
      }
    } else {
      shotIndex = state.selectedShot;
    }
    const globalShotIndex = shotIndex;


    const shot = state.generated.shots[globalShotIndex];
    const shotElapsed = autoAdvance ? position - cursor : elapsed;
    const shotProgress = Math.min(1, shotElapsed / (shot.duration * 1000));
    await renderPreviewFrame(shotProgress, globalShotIndex);
    elements.timelineProgress.style.width = `${progress * 100}%`;
    elements.timecode.textContent = `${formatTime(elapsed / 1000)} / ${formatTime(playbackDuration)}`;
    elements.timelineProgress.dataset.shotProgress = shotProgress;

    if (elapsed >= totalDuration) {
      stopPlayback();
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      renderPreviewFrame();
      elements.timelineProgress.style.width = "100%";
      return;
    }

    state.playback = {
      raf: requestAnimationFrame(frame),
      timer: null,
      recorder
    };
  };

  state.playback = {
    raf: requestAnimationFrame(frame),
    timer: null,
    recorder
  };
}

function getSupportedMimeType() {
  const types = [
    'video/webm;codecs="vp9,opus"',
    'video/webm;codecs="vp8,opus"',
    "video/webm",
    "video/mp4"
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("brandflow.settings") || "{}");
    const provider = PROVIDERS[saved.provider] || PROVIDERS.openai;
    return {
      provider: saved.provider || "openai",
      endpoint: saved.endpoint || provider.endpoint,
      model: saved.model || provider.model,
      apiKey: saved.apiKey || "",
      imageEnabled: saved.imageEnabled !== false,
      imageEndpoint: saved.imageEndpoint || "https://api.openai.com/v1/images/generations",
      imageModel: saved.imageModel || "gpt-image-1",
      imageSize: saved.imageSize || "auto",
      enabled: saved.enabled !== false
    };
  } catch {
    return {
      ...PROVIDERS.openai,
      provider: "openai",
      apiKey: "",
      enabled: true,
      imageEnabled: true,
      imageEndpoint: "https://api.openai.com/v1/images/generations",
      imageModel: "gpt-image-1",
      imageSize: "auto"
    };
  }
}

function saveSettings(settings) {
  localStorage.setItem("brandflow.settings", JSON.stringify(settings));
  if (window.Auth && window.Auth.isLoggedIn) {
    window.Auth.scheduleSync("brandflow.settings");
  }
  state.onlineEnabled = settings.enabled !== false;
  state.hasApiCredentials = Boolean(settings.apiKey && settings.endpoint && settings.model);
  state.apiConfigured = state.onlineEnabled && Boolean(settings.apiKey && settings.endpoint && settings.model);
  state.imageConfigured = settings.imageEnabled !== false && Boolean(settings.apiKey && settings.imageEndpoint && settings.imageModel);
  updateNetworkStatus();
}

function updateNetworkStatus() {
  elements.networkStatus.classList.remove("is-busy", "is-online");
  if (state.apiConfigured) {
    elements.networkStatus.classList.add("is-online");
    elements.networkStatusText.textContent = navigator.onLine ? "在线增强" : "当前离线";
  } else if (state.hasApiCredentials) {
    elements.networkStatusText.textContent = "在线增强已关闭";
  } else {
    elements.networkStatusText.textContent = "离线模式";
  }
}

async function testApi(settings) {
  elements.testApiButton.disabled = true;
  elements.settingsStatus.textContent = "正在测试连接";
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(settings.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: "user", content: "只回复：连接成功" }],
          max_tokens: 8,
          temperature: 0
        })
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    elements.settingsStatus.textContent = "在线服务可用";
    showToast("在线服务连接成功", "success");
  } catch (error) {
    elements.settingsStatus.textContent = `连接失败：${error.message}`;
    showToast(`在线服务不可用：${error.message}`, "error");
  } finally {
    elements.testApiButton.disabled = false;
  }
}

function bindEvents() {
  elements.navItems.forEach((item) => {
    item.addEventListener("click", () => showStep(item.dataset.stepTarget));
  });

  elements.briefForm.addEventListener("input", () => scheduleWorkspaceSave());
  elements.briefForm.addEventListener("change", () => scheduleWorkspaceSave());

  elements.generateButton.addEventListener("click", () => generateContent({ showPanel: true }));
  elements.regenerateButton.addEventListener("click", async () => {
    const result = await generateContent({ showPanel: false, forceNewVariant: true });
    if (result?.mode === "offline") {
      showToast("已生成新版本", "success");
    }
  });

  elements.directionControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-direction]");
    if (!button) {
      return;
    }
    state.direction = button.dataset.direction;
    elements.directionInput.value = state.direction;
    $$("[data-direction]", elements.directionControl).forEach((node) => {
      node.classList.toggle("active", node === button);
    });
    scheduleWorkspaceSave();
  });

  elements.copyScriptButton.addEventListener("click", () => {
    if (state.generated) {
      copyToClipboard(buildMarkdown(state.generated));
    }
  });

  elements.downloadMarkdownButton.addEventListener("click", () => {
    if (state.generated) {
      downloadText(buildMarkdown(state.generated), "品牌宣传脚本.md", "text/markdown");
    }
  });

  elements.foregroundInput.addEventListener("change", (event) => {
    loadForeground(event.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((type) => {
    elements.foregroundDrop.addEventListener(type, (event) => {
      event.preventDefault();
      elements.foregroundDrop.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    elements.foregroundDrop.addEventListener(type, (event) => {
      event.preventDefault();
      elements.foregroundDrop.classList.remove("dragging");
    });
  });
  elements.foregroundDrop.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (file) {
      loadForeground(file);
    }
  });

  elements.canvasStage.addEventListener("click", (event) => {
    if (!state.foregroundData || !state.cutoutCanvas) {
      return;
    }
    const rect = state.cutoutCanvas.getBoundingClientRect();
    const x = Math.round(state.cutoutOffset.x + (event.clientX - rect.left) / rect.width * state.cutoutCanvas.width);
    const y = Math.round(state.cutoutOffset.y + (event.clientY - rect.top) / rect.height * state.cutoutCanvas.height);
    const clampedX = Math.max(0, Math.min(elements.sourceCanvas.width - 1, x));
    const clampedY = Math.max(0, Math.min(elements.sourceCanvas.height - 1, y));
    const offset = (clampedY * elements.sourceCanvas.width + clampedX) * 4;
    state.sampleColor = [
      state.foregroundData.data[offset],
      state.foregroundData.data[offset + 1],
      state.foregroundData.data[offset + 2]
    ];
    elements.cutoutMethod.value = "color";
    setCanvasHint(`已取样 RGB ${state.sampleColor.join(", ")}`);
    processCutout();
    updateCompositeCanvas();
  });

  elements.cutoutMethod.addEventListener("change", () => scheduleCutout(0));
  elements.tolerance.addEventListener("input", () => {
    elements.toleranceValue.textContent = elements.tolerance.value;
    scheduleCutout();
  });
  elements.feather.addEventListener("input", () => {
    elements.featherValue.textContent = elements.feather.value;
    scheduleCutout();
  });

  elements.backgroundInput.addEventListener("change", (event) => {
    loadCustomBackground(event.target.files[0]);
  });

  elements.downloadCutoutButton.addEventListener("click", () => {
    if (!state.cutoutCanvas) {
      showToast("请先上传主体素材", "error");
      return;
    }
    downloadDataUrl(state.cutoutCanvas.toDataURL("image/png"), "透明主体.png");
  });

  elements.applyCompositeButton.addEventListener("click", async () => {
    if (!state.foregroundData) {
      showToast("请先上传主体素材", "error");
      return;
    }
    updateCompositeCanvas();
    await renderPreviewFrame();
    showStep("export");
    showToast("合成结果已应用到分镜", "success");
  });

  elements.playButton.addEventListener("click", () => startPlayback({ record: false }));
  elements.voiceButton.addEventListener("click", speakCurrentScript);
  elements.downloadSrtButton.addEventListener("click", () => {
    if (state.generated) {
      downloadText(buildSrt(state.generated), "品牌视频字幕.srt", "application/x-subrip");
    }
  });
  elements.aiBriefButton.addEventListener("click", generateBriefWithAi);
  elements.resetClipButton.addEventListener("click", resetClipRange);
  elements.clipStart.addEventListener("input", normalizeClipRange);
  elements.clipEnd.addEventListener("input", normalizeClipRange);
  elements.playClipButton.addEventListener("click", () => startPlayback({ record: false, clip: true }));
  elements.exportClipButton.addEventListener("click", () => startPlayback({ record: true, clip: true }));
  elements.exportVideoButton.addEventListener("click", () => startPlayback({ record: true }));
  elements.prevShotButton.addEventListener("click", () => navigateShot(-1));
  elements.nextShotButton.addEventListener("click", () => navigateShot(1));
  elements.shotScene.addEventListener("input", commitShotEditor);
  elements.shotSubtitle.addEventListener("input", commitShotEditor);
  elements.shotDuration.addEventListener("input", commitShotEditor);
  elements.shotMotion.addEventListener("change", commitShotEditor);
  elements.subtitleToggle.addEventListener("change", renderPreviewFrame);
  elements.autoAdvanceToggle.addEventListener("change", () => {
    if (!elements.autoAdvanceToggle.checked) {
      showToast("已关闭自动切镜，当前镜头将单独导出");
    }
  });

  elements.settingsButton.addEventListener("click", () => {
    const settings = readSettings();
    elements.providerSelect.value = settings.provider;
    elements.apiEndpoint.value = settings.endpoint;
    elements.apiModel.value = settings.model;
    elements.apiKey.value = settings.apiKey;
    elements.imageEndpoint.value = settings.imageEndpoint;
    elements.imageModel.value = settings.imageModel;
    elements.imageSize.value = settings.imageSize;
    elements.imageEnhancementToggle.checked = settings.imageEnabled;
    elements.onlineEnhancementToggle.checked = settings.enabled;
    elements.settingsStatus.textContent = state.apiConfigured
      ? "在线增强已启用"
      : state.hasApiCredentials ? "配置已保留，在线增强已关闭" : "当前为完全离线规则引擎";
    elements.settingsModal.hidden = false;
    window.setTimeout(() => elements.closeSettingsButton.focus(), 0);
  });

  elements.networkStatus.addEventListener("click", () => elements.settingsButton.click());

  elements.closeSettingsButton.addEventListener("click", () => {
    elements.settingsModal.hidden = true;
  });
  elements.settingsModal.addEventListener("click", (event) => {
    if (event.target === elements.settingsModal) {
      elements.settingsModal.hidden = true;
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.settingsModal.hidden) {
      elements.settingsModal.hidden = true;
      elements.settingsButton.focus();
    }
  });

  elements.providerSelect.addEventListener("change", () => {
    const preset = PROVIDERS[elements.providerSelect.value];
    if (preset) {
      elements.apiEndpoint.value = preset.endpoint;
      elements.apiModel.value = preset.model;
    }
  });

  elements.testApiButton.addEventListener("click", () => {
    testApi({
      endpoint: elements.apiEndpoint.value.trim(),
      model: elements.apiModel.value.trim(),
      apiKey: elements.apiKey.value.trim()
    });
  });

  elements.saveSettingsButton.addEventListener("click", () => {
    const settings = {
      provider: elements.providerSelect.value,
      endpoint: elements.apiEndpoint.value.trim(),
      model: elements.apiModel.value.trim(),
      apiKey: elements.apiKey.value.trim(),
      imageEnabled: elements.imageEnhancementToggle.checked,
      imageEndpoint: elements.imageEndpoint.value.trim(),
      imageModel: elements.imageModel.value.trim(),
      imageSize: elements.imageSize.value,
      enabled: elements.onlineEnhancementToggle.checked
    };
    saveSettings(settings);
    elements.settingsModal.hidden = true;
    showToast(
      state.apiConfigured
        ? "在线增强已开启"
        : state.hasApiCredentials ? "在线增强已关闭，配置已保留" : "已恢复完全离线模式",
      "success"
    );
  });

  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  window.addEventListener("beforeunload", stopPlayback);
  window.addEventListener("beforeunload", saveWorkspace);
}

async function init() {
  cacheElements();
  bindEvents();
  resizePreviewCanvas();
  updateNetworkStatus();
  await renderBackgroundLibrary();
  if (state.backgroundCache.has(state.selectedBackgroundId)) {
    updateNetworkStatus();
  }

  const settings = readSettings();
  state.onlineEnabled = settings.enabled !== false;
  state.hasApiCredentials = Boolean(settings.apiKey && settings.endpoint && settings.model);
  state.apiConfigured = state.onlineEnabled && state.hasApiCredentials;
  state.imageConfigured = settings.imageEnabled !== false && Boolean(settings.apiKey && settings.imageEndpoint && settings.imageModel);
  updateNetworkStatus();

  const restoredWorkspace = restoreWorkspace();
  if (restoredWorkspace) {
    state.selectedShot = 0;
    renderGeneratedContent(state.generated);
    showToast("已恢复上次未完成的项目");
  } else {
    await generateContent({ showPanel: false });
  }

  const requestedStep = new URLSearchParams(location.search).get("step") || location.hash.slice(1);
  if (["brief", "content", "compose", "export"].includes(requestedStep)) {
    showStep(requestedStep);
  }
}

// 等待登录完成后再初始化应用；未引入 auth.js 时直接初始化
if (window.Auth) {
  window.Auth.onReady(function () { init(); });
} else {
  init();
}

window.BrandFlow = {
  get state() { return state; },
  get elements() { return elements; },
  getBrief,
  fillBriefFromSummary,
  applyConversationResult,
  normalizeGeneratedContent,
  generatePosterCanvas,
  addGeneratedBackground,
  offlineGenerate,
  generateWithApi,
  requestChatCompletion,
  parseJsonLoose,
  setSelectByText,
  readSettings,
  showStep,
  showToast,
  escapeHtml,
  renderGeneratedContent,
  updateExportSummary,
  renderPreviewFrame,
  generateContent,
  downloadBlob,
  downloadText,
  getBackground,
  drawCover,
  wrapText,
  getCanvasDimensions,
  BACKGROUNDS
};
