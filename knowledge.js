/* ============================================================
 * knowledge.js
 * 智影工坊 知识助手：本地检索引擎 + 工具 + 意图识别 + 编排
 * 纯前端、离线可用：bigram TF-IDF 余弦 + 覆盖度，阈值 0.72。
 * ============================================================ */
(function () {
  const CHUNKS = window.KNOWLEDGE_CHUNKS || [];
  const PLATFORM_SPECS = window.PLATFORM_SPECS || {};
  const BANNED_WORDS = window.BANNED_WORDS || [];

  const STOP_CHARS = new Set(("的 了 是 我 你 他 她 它 们 吗 呢 吧 啊 在 和 与 及 或 一 个 有 就 都 也 很 被 把 让 向 对 为 这 那 之 其 以 于 可 能 要 会 说 去 来 又 再 才").split(" "));

  /* ---------- 分词：中文以 bigram 为主（+关键 unigram 加权），英文数字按词 ---------- */
  function tokenize(text) {
    const tokens = [];
    const s = String(text).toLowerCase();
    const han = s.match(/[\u4e00-\u9fa5]/g) || [];
    for (let i = 1; i < han.length; i++) {
      const bg = han[i - 1] + han[i];
      tokens.push(bg, bg);                        // bigram（强语义，双倍权重）
    }
    for (let i = 0; i < han.length; i++) {
      if (!STOP_CHARS.has(han[i])) tokens.push(han[i]);   // unigram（补充）
    }
    (s.match(/[a-z0-9]+/g) || []).forEach((w) => tokens.push(w));
    return tokens;
  }

  function termFreq(tokens) {
    const tf = new Map();
    tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    return tf;
  }

  /* ---------- 构建索引（idf + 块向量） ---------- */
  const N = CHUNKS.length;
  const df = new Map();
  CHUNKS.forEach((c) => {
    new Set(tokenize(c.text)).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });
  function idf(term) {
    return Math.log((N + 1) / ((df.get(term) || 0) + 0.5)) + 1;
  }
  function vectorize(tokens) {
    const tf = termFreq(tokens);
    const v = new Map();
    tf.forEach((cnt, t) => {
      v.set(t, (1 + Math.log(cnt)) * idf(t));   // sublinear TF * IDF
    });
    let norm = 0;
    v.forEach((x) => (norm += x * x));
    norm = Math.sqrt(norm) || 1;
    v.forEach((x, t) => v.set(t, x / norm));
    return v;
  }
  const chunkVectors = CHUNKS.map((c) => ({
    chunk: c,
    vec: vectorize(tokenize(c.text)),
    textTerms: new Set(tokenize(c.text))
  }));

  function cosine(a, b) {
    let dot = 0;
    a.forEach((x, t) => {
      if (b.has(t)) dot += x * b.get(t);
    });
    return dot;
  }

  /* query 有效（去停用 unigram、bigram、英文词）在块中的加权覆盖度 */
  function coverage(queryTokens, chunk) {
    let total = 0, hit = 0;
    queryTokens.forEach((t) => {
      const w = idf(t);
      total += w;
      if (chunk.textTerms.has(t)) hit += w;
    });
    return total ? hit / total : 0;
  }

  /* ---------- 关键词聚焦：从口语中抽取领域术语并加权，弱化背景叙述 ---------- */
  const CONCEPT_TERMS = ["核心卖点", "卖点", "提炼", "品牌定位", "定位", "差异化", "目标人群", "人群",
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
    "脚本", "运营", "流量", "涨粉", "数据"];
  function buildFocusedQuery(query) {
    const s = String(query).toLowerCase();
    const hits = CONCEPT_TERMS.filter((t) => s.includes(t.toLowerCase()));
    const concept = hits.join(" ");
    if (!concept) return query;
    return `${concept} ${concept} ${query}`;   // 领域术语 2 倍 + 原句 1 倍
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
  function extractConcepts(query) {
    const s = String(query).toLowerCase();
    let hits = CONCEPT_TERMS.filter((t) => s.includes(t.toLowerCase()));
    // 同义词扩展：把口语词映射到领域概念
    Object.entries(SYNONYMS).forEach(([word, concepts]) => {
      if (s.includes(word.toLowerCase())) {
        concepts.forEach((c) => { if (!hits.includes(c)) hits.push(c); });
      }
    });
    hits.sort((a, b) => b.length - a.length);
    const kept = [];
    hits.forEach((h) => { if (!kept.some((k) => k.includes(h))) kept.push(h); });
    return kept;
  }
  function tagMatch(concept, tag) {
    const c = concept.toLowerCase(), t = tag.toLowerCase();
    return t === c || t.includes(c) || c.includes(t);
  }

  /* ---------- 检索：元数据标签匹配（主） + TF-IDF 语义（辅），返回 Top-K ---------- */
  function search(query, topK = 3) {
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
      return { chunk: cv.chunk, cosine: cos, coverage: 0, score: Math.min(score, 1) };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /* ================= 工具 ================= */

  /* 工具1：知识库检索（含无命中判定） */
  function knowledgeSearch(query, topK = 3, threshold = 0.72) {
    const hits = search(query, topK);
    const top = hits[0];
    if (!top || top.score < threshold) {
      return { matched: false, hits, threshold };
    }
    return { matched: true, hits, threshold };
  }

  /* 工具2：平台规范查询（无匹配不编造） */
  function platformSpecQuery(platform, aspect) {
    const spec = PLATFORM_SPECS[platform];
    if (!spec) {
      return { matched: false, message: `暂未收录「${platform || "该平台"}」的技术规范，建议查阅平台官方说明。` };
    }
    let resolution = null;
    if (aspect && spec.ratios[aspect]) resolution = spec.ratios[aspect];
    if (!resolution) resolution = Object.entries(spec.ratios).map(([k, v]) => `${k} ${v}`).join("；");
    return {
      matched: true, platform,
      resolution,
      duration: spec.duration,
      safe: spec.safe,
      codec: spec.codec
    };
  }

  /* 工具3：违禁词校验 */
  function complianceCheck(text) {
    const hits = [];
    BANNED_WORDS.forEach((b) => {
      if (String(text).includes(b.word)) hits.push(b);
    });
    return { passed: hits.length === 0, hits };
  }

  /* ================= 意图识别 ================= */
  const PLATFORM_NAMES = Object.keys(PLATFORM_SPECS);
  const PRIVACY_PATTERNS = [
    { name: "手机号", re: /1[3-9]\d{9}/ },
    { name: "身份证号", re: /\d{17}[\dXx]/ },
    { name: "银行卡号", re: /\b\d{16,19}\b/ }
  ];

  function detectPrivacy(text) {
    for (const p of PRIVACY_PATTERNS) if (p.re.test(text)) return p.name;
    return null;
  }

  function detectIntent(text) {
    const s = String(text);
    const hasPlatform = PLATFORM_NAMES.some((p) => s.includes(p)) ||
      (s.includes("小红书") ? true : false);
    if ((/分辨率|画幅|比例|尺寸|多大|多少|时长|安全区|竖屏|横屏/).test(s) &&
        (hasPlatform || (/平台/).test(s))) {
      const platform = PLATFORM_NAMES.find((p) => s.includes(p)) ||
        (s.includes("小红书") ? "小红书" : null);
      return { type: "spec", platform };
    }
    if ((/广告法|合规|违禁|极限词|违法|违规|能不能写|可以写吗|允许/).test(s)) {
      return { type: "compliance" };
    }
    // 违规 / 恶意请求
    if ((/抹黑|黑一下|诋毁|贬低|骂|恶搞|造假|售假|无证|根治|包治|药到病除|全国第一|国家级|疗效广告/).test(s)) {
      return { type: "refuse", reason: "请求包含贬低、抹黑、虚假违法或违禁表述" };
    }
    // 聊天 / 求思路 / 开场闲聊
    if ((/^你好|^您好|^hi|^hello|^嗨|^在吗|早上好|下午好|晚上好/i).test(s) ||
        (/帮我想想|给点思路|给点建议|有什么想法|出出主意|brainstorm|灵感|创意方向|不知道写什么|没思路|怎么开始|如何入手|我该从哪开始/).test(s) ||
        (/你是谁|你能做什么|介绍一下你自己|你会什么/).test(s)) {
      return { type: "chat" };
    }
    // 硬超纲：与品牌营销、视频制作完全无关
    if ((/作文|数学题|英语作文|天气|股票|股价|彩票|游戏代练|写一首诗|翻译文章/).test(s) &&
        !(/视频|文案|分镜|宣传|品牌|营销|卖点|广告/).test(s)) {
      return { type: "refuse", reason: "这个问题不在我的服务范围内，我专注于品牌营销与短视频制作相关的咨询" };
    }
    // 边界：含糊、含指代且信息不足
    const meaningful = s.replace(/[，。？?！!、\s]/g, "");
    if ((/那个|这事|那事|这个东西|随便|看着办/).test(s) && meaningful.length <= 12) {
      return { type: "clarify" };
    }
    if (meaningual_length(s) < 5 && !(/怎么|如何|什么|哪/).test(s)) {
      return { type: "clarify" };
    }
    // 默认为营销/方法知识问答
    return { type: "knowledge" };
  }
  function meaningual_length(s) {
    return (s.match(/[\u4e00-\u9fa5a-z0-9]/gi) || []).length;
  }

  /* ================= 系统提示词 ================= */
  // 知识问答模式（基于检索片段）
  const SYSTEM_PROMPT = [
    "【角色】你是智影工坊内置的品牌营销知识助手，熟悉短视频品牌营销、文案分镜、平台规范与广告合规。",
    "【约束】优先依据提供的参考资料作答；不得编造条款、数据与出处；不得输出“国家级、最佳、第一、根治”等违规极限词。",
    "【输出格式】知识类问题固定三行——第一行结论；第二行依据（格式“依据：《文档名》·章节”）；第三行操作建议（如无则省略）。",
    "【对话】用户闲聊或求思路时，语气自然友好，像一位有经验的品牌策划同事，可以主动提问了解背景后再给建议。"
  ].join("\n");

  // 聊天/思路模式（不强制基于检索片段，更开放）
  const CHAT_PROMPT = [
    "【角色】你是智影工坊的资深品牌营销顾问，有5年短视频策划经验，帮几十个消费品牌做过爆款视频。你说话像一个很懂行的朋友——亲切、直接、有干货，不端着。",
    "【你能做什么】",
    "1. 帮用户理品牌定位：卖给谁、什么场景下用、和别人有什么不一样",
    "2. 提炼卖点：把产品参数翻译成用户一听就懂的好处",
    "3. 写文案：直接给示例口播稿、标题、宣传语，用户拿去就能改",
    "4. 讨论文案和分镜方向：开场怎么抓人、6个镜头怎么安排",
    "5. 解答平台规则和合规问题",
    "【对话方式】",
    "- 像微信聊天一样自然，不要用书面语和模板腔",
    "- 用户说的不清楚时，主动追问1-2个关键问题，不要自己瞎猜",
    "- 给建议要具体，不要说空话。不说「要突出卖点」，要说「可以主打「0糖冷萃，通勤路上开盖就能喝」这个点」",
    "- 用户要文案就直接写，不要只说方法。比如用户说「帮我写个咖啡的口播」，你直接写出三段式文案",
    "- 记得之前聊过的产品和上下文，不要每次都重新问一遍",
    "- 每次回复不要太长，3-6句话说完，重点用编号列出来",
    "【边界】只聊品牌营销、短视频制作相关的事；不编造具体法规条款号；不说「国家级、最佳、第一」这类极限词"
  ].join("\n");

  /* ================= 编排 ================= */
  const FALLBACK_TEXT = "暂未在知识库中找到可靠依据，建议补充信息或咨询专业人员。";

  // 离线聊天回复：打招呼、求思路等闲聊场景的友好回应
  function offlineChatReply(text, session) {
    const s = String(text);
    session = session || {};
    const knownProduct = session.product || null;
    const knownAudience = session.audience || null;

    // --- 关键词提取：从用户输入中识别产品/行业 ---
    const PRODUCT_KEYWORDS = {
      "咖啡": { category: "饮品", audience: "18-35岁城市上班族", angle: "场景+功效定位" },
      "冷萃": { category: "饮品", audience: "20-35岁品质上班族", angle: "工艺+口感定位" },
      "奶茶": { category: "饮品", audience: "18-28岁学生/年轻女生", angle: "颜值+社交定位" },
      "护肤": { category: "美妆个护", audience: "20-35岁女性", angle: "成分+功效定位" },
      "面膜": { category: "美妆个护", audience: "20-30岁女性", angle: "功效+场景定位" },
      "健身": { category: "健康运动", audience: "20-40岁都市人群", angle: "痛点+效果定位" },
      "瑜伽": { category: "健康运动", audience: "25-40岁女性", angle: "情绪+健康定位" },
      "手机壳": { category: "3C配件", audience: "18-28岁年轻用户", angle: "颜值+个性定位" },
      "零食": { category: "食品", audience: "18-35岁追剧/办公人群", angle: "解馋+无负担定位" },
      "宠物": { category: "宠物用品", audience: "20-40岁铲屎官", angle: "情感+品质定位" },
      "母婴": { category: "母婴育儿", audience: "25-35岁宝妈", angle: "安全+安心定位" },
      "服装": { category: "服饰", audience: "20-35岁职场人", angle: "场景+品质定位" },
      "蛋糕": { category: "食品烘焙", audience: "20-35岁年轻人", angle: "颜值+仪式感定位" },
    };

    let detectedProduct = null;
    for (const [key, info] of Object.entries(PRODUCT_KEYWORDS)) {
      if (s.includes(key)) { detectedProduct = { name: key, ...info }; break; }
    }
    // 如果用户这次提到了新产品，更新 session 作为上下文
    if (detectedProduct) {
      session.product = detectedProduct.name;
      if (!session.audience) session.audience = detectedProduct.audience;
    }

    // --- 打招呼类 ---
    if ((/^你好|^您好|^hi|^hello|^嗨|^在吗/i).test(s)) {
      return {
        kind: "chat",
        text: "你好呀！我是你的品牌营销助手 🎬\n\n不管是刚起步不知道怎么做，还是已有产品想优化视频内容，都可以跟我聊。\n\n你可以直接说：\n· 「我有个咖啡品牌，不知道怎么做宣传」\n· 「帮我想想护肤品的卖点」\n· 「小红书的视频有什么规范？」\n\n说说你的情况，我来帮你理思路。"
      };
    }

    // --- 自我介绍 ---
    if (/你是谁|你能做什么|介绍一下|你会什么/.test(s)) {
      return {
        kind: "chat",
        text: "我是智影工坊的品牌营销助手，擅长帮你：\n\n🎯 理清品牌定位——你是谁、卖给谁、有什么不一样\n✨ 提炼核心卖点——用 FABE 方法把产品参数变成用户好处\n📝 讨论文案和分镜方向——开场怎么抓人、6个镜头怎么安排\n📱 解答平台规范——抖音/小红书/视频号的画幅时长要求\n⚖️ 检查合规——哪些词不能用，怎么替换更安全\n\n直接说你的产品和问题就行，咱们一起聊。"
      };
    }

    // --- 上下文已有产品，用户在追问（离线也能记住聊过什么） ---
    if (knownProduct && !detectedProduct) {
      // 用户说"那卖点呢"、"怎么写文案"、"思路呢" —— 追问之前的产品
      if (/卖点|文案|脚本|标题|思路|方向|怎么写|如何写|写什么|具体点|然后呢/.test(s)) {
        return {
          kind: "chat",
          text: `好嘞，咱们接着说${knownProduct}的事 👇\n\n💡 先给你一个卖点框架（FABE方法）：\n· 特性（Feature）：${knownProduct}客观上有什么特点？\n· 优势（Advantage）：这个特点比同类好在哪？\n· 利益（Benefit）：用户用了能得到什么好处？\n· 证据（Evidence）：有什么数据/事实能证明？\n\n要不要我先给你写一版示例文案？你告诉我${knownProduct}具体主打什么，我直接出一版口播稿。`
        };
      }
      // 用户说"再想想"、"还有吗" —— 继续 brainstorm
      if (/再想想|还有吗|换个思路|别的方向|再给几个|其他方向/.test(s)) {
        return {
          kind: "chat",
          text: `行，再给你几个${knownProduct}的内容方向：\n\n1️⃣ 场景种草型：拍一个目标用户日常遇到麻烦的场景，然后${knownProduct}出现解决问题\n2️⃣ 对比测评型：把${knownProduct}和同类放在一起对比，突出差异点\n3️⃣ 知识科普型：讲一个和${knownProduct}相关的小知识，顺便带出产品\n4️⃣ 情感故事型：围绕用${knownProduct}的用户故事，打情感牌\n\n你觉得哪个方向更对你的胃口？我可以帮你把那个方向展开成具体脚本。`
        };
      }
    }

    // --- 用户要写文案/写脚本 ---
    if (/写文案|写个文案|写口播|写脚本|写标题|写宣传语|写一段话|文案怎么写|口播稿|写个脚本/.test(s)) {
      if (knownProduct) {
        return {
          kind: "chat",
          text: `好，给你写一版${knownProduct}的口播文案框架 ✍️\n\n【开场钩子】（前3秒）：\n"你知道吗？${knownProduct}居然可以这样用……"\n\n【痛点+产品】（中间）：\n"平时我们遇到XX问题，其实一款${knownProduct}就能搞定，……"\n\n【行动号召】（结尾）：\n"想试试的朋友，点击下方链接/来店里看看～"\n\n你觉得这个方向行不行？告诉我${knownProduct}具体主打什么特点，我帮你把文案写得更具体。`
        };
      }
      return {
        kind: "chat",
        text: "写文案没问题！为了给你写得准，先告诉我：\n\n· 是什么产品？\n· 想突出什么卖点？\n· 发在哪个平台（抖音/小红书/视频号）？\n\n你说个大概，我直接给你出一版口播稿，你来改。"
      };
    }

    // --- 用户提到了具体产品/行业 ---
    if (detectedProduct) {
      const p = detectedProduct;
      return {
        kind: "chat",
        text: `哦，${p.name}类的！这个品类做短视频其实很有发挥空间 👍\n\n基于${p.name}${p.category === "饮品/餐饮" ? "饮品" : p.category}的特点，我建议你先从这几个方向想：\n\n1️⃣ 定位角度：${p.angle}——比如${p.audience}在什么场景下最需要这个？\n2️⃣ 卖点切入：是讲成分/工艺，还是讲使用场景带来的感受？\n3️⃣ 内容形式：是产品展示、场景种草，还是知识科普？\n\n你现在${p.name}是处于刚起步阶段，还是已经有一定基础了？我可以帮你进一步拆解。`
      };
    }

    // --- 求思路 / 不知道写什么 ---
    if (/帮我想想|给点思路|给点建议|有什么想法|出出主意|灵感|创意方向|不知道写什么|没思路|怎么开始|如何入手|我该从哪开始|点子/.test(s)) {
      return {
        kind: "chat",
        text: "没问题！头脑风暴最有意思了 💡\n\n咱们一步步来：\n\n1. 先说说你的产品是什么？（比如：冷萃咖啡、手机壳、瑜伽课、护肤品……）\n2. 主要想卖给谁？（比如：通勤上班族、大学生、宝妈、精致女生……）\n3. 你最想让用户看完视频后做什么？（比如：下单、关注、到店……）\n\n你简单说几句就行，我来帮你梳理卖点和内容方向。"
      };
    }

    // --- 用户描述了产品/情况 ---
    if (/我是|我有|我们是|我们的|我们做的|做了一个/.test(s)) {
      return {
        kind: "chat",
        text: "收到！我理解一下——你是想做品牌宣传/视频内容对吧？\n\n为了给你更具体的建议，我还想知道：\n\n· 你的产品最核心的特点是什么？（和别人比，不一样在哪）\n· 目标用户大概是什么样的人？\n\n你说个大概就行，不用很正式，我帮你整理成清晰的卖点和内容思路。"
      };
    }

    // --- 用户问方法/怎么做 ---
    if (/怎么|如何|怎样|咋|如何做|怎么做/.test(s) && /写|文案|卖点|定位|分镜|脚本|内容|创意/.test(s)) {
      // 先尝试知识检索，如果命中就用知识回答
      const result = knowledgeSearch(s, 3, 0.65);
      if (result.matched) {
        const a = buildAnswer(result.hits);
        const lines = [`结论：${a.conclusion}`, a.basis, `操作建议：${a.advice}`];
        return {
          kind: "answer",
          text: lines.join("\n"),
          sources: result.hits.map((h) => ({ docName: h.chunk.docName, section: h.chunk.section, score: h.score }))
        };
      }
      return {
        kind: "chat",
        text: "这个问题问得好！具体怎么做取决于你的产品和目标人群。\n\n你可以先告诉我：\n· 是什么产品/服务？\n· 想在哪个平台发（抖音/小红书/视频号）？\n\n我就能给你更落地的建议了。"
      };
    }

    // --- 其他聊天默认回应 ---
    return {
      kind: "chat",
      text: "好的，我在听 😊\n\n你可以直接把你的产品和遇到的问题告诉我——比如「想做个护肤品牌的宣传视频不知道从哪下手」、「我们的咖啡想在小红书推一下」，我就能帮你拆解思路了。"
    };
  }

  function buildAnswer(hits) {
    // 第 5 周增强：综合 Top-3 片段，而非只取首句
    const top = hits[0];
    const c = top.chunk;

    // 结论：取 top1 首句；若 top1 较短且 top2 有补充，追加一句
    let conclusion = c.text.split(/。/)[0] + "。";
    if (hits.length > 1 && conclusion.length < 40) {
      const second = hits[1].chunk.text.split(/。/)[0];
      if (second && second !== c.text.split(/。/)[0]) {
        conclusion += second + "。";
      }
    }

    // 依据：汇总所有命中片段的出处（去重）
    const sources = [];
    const seen = new Set();
    hits.forEach((h) => {
      const key = h.chunk.docName + h.chunk.section;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(`《${h.chunk.docName}》·${h.chunk.section}`);
      }
    });
    const basis = "依据：" + sources.join("；");

    // 操作建议：从所有命中片段中提取建议句，取最相关的 1-2 条
    const adviceSet = new Set();
    const adviceList = [];
    hits.forEach((h) => {
      const matches = h.chunk.text.match(/[^。]*(?:建议|可采用|可以|应当|应先|优先|宜|需)[^。]*。/g) || [];
      matches.forEach((m) => {
        const trimmed = m.trim();
        if (trimmed && !adviceSet.has(trimmed) && adviceList.length < 2) {
          adviceSet.add(trimmed);
          adviceList.push(trimmed);
        }
      });
    });
    const advice = adviceList.length
      ? adviceList.join(" ")
      : "可结合你的产品与目标人群，按上述方法整理卖点与分镜。";

    return { conclusion, basis, advice };
  }

  function runAdvisor(rawText, session) {
    const text = String(rawText || "").trim();
    if (!text) {
      return { kind: "clarify", text: "请输入你想咨询的品牌营销或视频制作问题。" };
    }
    // 1) 隐私
    const privacy = detectPrivacy(text);
    if (privacy) {
      return { kind: "privacy", text: `检测到可能包含${privacy}，请先做脱敏处理后再提问；系统不会记录该原文。` };
    }
    // 2) 意图
    const intent = detectIntent(text);

    if (intent.type === "clarify") {
      return { kind: "clarify", text: "为了给你准确建议，请补充：你的产品是什么、目标人群是谁，以及你想解决的具体问题（如卖点提炼、分镜设计、平台规范）。" };
    }
    if (intent.type === "refuse") {
      return { kind: "refuse", text: `抱歉，无法满足该请求（${intent.reason}）。我只提供品牌定位、卖点提炼、文案分镜、平台规范与宣传合规方面的帮助。` };
    }
    if (intent.type === "chat") {
      return offlineChatReply(text, session);
    }
    if (intent.type === "spec") {
      const aspect = (/9:16|竖屏/).test(text) ? "9:16"
        : (/16:9|横屏/).test(text) ? "16:9"
        : (/1:1|方形/).test(text) ? "1:1"
        : (/3:4/).test(text) ? "3:4" : null;
      const r = platformSpecQuery(intent.platform, aspect);
      if (!r.matched) {
        return { kind: "fallback", text: r.message, sources: [] };
      }
      const lines = [
        `结论：${r.platform}${aspect ? " " + aspect : ""}推荐分辨率 ${r.resolution}；${r.duration}。`,
        `依据：《主流短视频平台技术规范汇编》·${r.platform} 技术规范`,
        `操作建议：关键内容放在安全区（${r.safe}）；导出用 ${r.codec}。`
      ];
      return { kind: "answer", text: lines.join("\n"), sources: [{ docName: "主流短视频平台技术规范汇编", section: r.platform, score: 1 }] };
    }
    // knowledge / compliance：检索
    const result = knowledgeSearch(text, 3, 0.72);
    if (!result.matched) {
      session.fallbackCount = (session.fallbackCount || 0) + 1;
      // 先尝试用聊天兜底——更自然，还能接住产品描述和追问
      const chatReply = offlineChatReply(text, session);
      // 如果聊天回复不是默认的"我在听"那种通用回应，就用聊天回复
      if (chatReply.text && !chatReply.text.includes("好的，我在听")) {
        return chatReply;
      }
      // 否则用标准知识兜底
      const needHuman = session.fallbackCount >= 2;
      return {
        kind: "fallback",
        text: needHuman
          ? FALLBACK_TEXT + "\n已多次未能解答，建议通过「转人工咨询」获取帮助。"
          : FALLBACK_TEXT,
        sources: result.hits.slice(0, 1).map((h) => ({ docName: h.chunk.docName, section: h.chunk.section, score: h.score })),
        needHuman
      };
    }
    const a = buildAnswer(result.hits);
    // 校验答案与用户文案是否含违禁词
    const check = complianceCheck(text + a.conclusion + a.advice);
    let lines = [`结论：${a.conclusion}`, a.basis, `操作建议：${a.advice}`];
    if (!check.passed) {
      const words = [...new Set(check.hits.map((h) => h.word))].join("、");
      lines.push(`合规提示：检测到「${words}」等表述，建议替换（${check.hits[0].suggest}）。`);
    }
    return {
      kind: "answer",
      text: lines.join("\n"),
      sources: result.hits.map((h) => ({ docName: h.chunk.docName, section: h.chunk.section, score: h.score }))
    };
  }

  /* 在线增强：用四要素提示词 + 检索片段请求大模型；失败由调用方回退本地 */
  async function onlineAnswer(query, hits, settings) {
    const context = hits.map((h, i) => `[${i + 1}]《${h.chunk.docName}》·${h.chunk.section}\n${h.chunk.text}`).join("\n\n");
    const userContent = `参考资料：\n${context}\n\n请依据以上资料回答（固定三行：结论、依据、操作建议）：${query}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch(settings.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model, temperature: 0.4,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent }
          ]
        })
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("空响应");
      const check = complianceCheck(content);
      return { text: content, compliance: check };
    } finally {
      clearTimeout(timer);
    }
  }

  /* 在线聊天：开放对话模式，不强制基于检索片段 */
  async function onlineChat(query, settings, history) {
    const messages = [{ role: "system", content: CHAT_PROMPT }];
    // 带上最近的对话历史（最多4轮），让回复更连贯
    if (history && history.length) {
      history.slice(-4).forEach((h) => {
        messages.push({ role: h.role, content: h.content });
      });
    }
    messages.push({ role: "user", content: query });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch(settings.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model, temperature: 0.7,
          messages
        })
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("空响应");
      const check = complianceCheck(content);
      return { text: content, compliance: check };
    } finally {
      clearTimeout(timer);
    }
  }

  /* 在线聊天 + 上下文 + RAG参考（统一入口） */
  async function onlineChatWithContext(query, settings, history, hits) {
    const messages = [{ role: "system", content: CHAT_PROMPT }];

    // 带上最近的对话历史（最多 5 轮）
    if (history && history.length) {
      history.slice(-6).forEach((h) => {
        messages.push({ role: h.role, content: h.content });
      });
    }

    // 如果有检索到相关知识片段，拼到用户消息里作为参考
    let userContent = query;
    if (hits && hits.length >= 1) {
      const context = hits.map((h, i) => `【参考${i + 1}】《${h.chunk.docName}》·${h.chunk.section}\n${h.chunk.text}`).join("\n\n");
      userContent = `以下是知识库中的相关参考内容，请结合它们回答问题，但不要生硬照搬：\n\n${context}\n\n---\n\n用户问题：${query}`;
    }

    messages.push({ role: "user", content: userContent });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch(settings.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model, temperature: 0.7,
          messages
        })
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("空响应");
      const check = complianceCheck(content);
      return { text: content, compliance: check };
    } finally {
      clearTimeout(timer);
    }
  }

  /* 导出 */
  window.Knowledge = {
    search, knowledgeSearch, platformSpecQuery, complianceCheck,
    detectIntent, detectPrivacy, runAdvisor, onlineAnswer, onlineChat, onlineChatWithContext,
    offlineChatReply,
    systemPrompt: SYSTEM_PROMPT, chatPrompt: CHAT_PROMPT, tokenize
  };
})();
