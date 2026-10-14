/* ============================================================
 * advisor.app.js
 * 知识助手交互（自包含，在 app.js 之后加载）
 * 依赖 window.Knowledge（knowledge.js）；在线设置读取 localStorage。
 * ============================================================ */
(function () {
  const chat = document.getElementById("advisorChat");
  const form = document.getElementById("advisorForm");
  const input = document.getElementById("advisorInput");
  const clearBtn = document.getElementById("advisorClear");
  const samples = document.getElementById("advisorSamples");
  const scriptBtn = document.getElementById("advisorGenerateScript");
  const posterBtn = document.getElementById("advisorGeneratePoster");
  if (!chat || !window.Knowledge) return;

  const session = { fallbackCount: 0 };
  // 对话历史：保留最近 4 轮，供在线大模型理解上下文
  const history = [];
  const STORAGE_KEY = "brandflow.advisor.conversation.v1";
  const messages = [];
  let chatResult = null;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function readSettings() {
    try {
      const s = JSON.parse(localStorage.getItem("brandflow.settings") || "{}");
      return {
        endpoint: s.endpoint, model: s.model, apiKey: s.apiKey,
        enabled: s.enabled !== false
      };
    } catch {
      return { enabled: true };
    }
  }
  function onlineReady() {
    const s = readSettings();
    return s.enabled && s.apiKey && s.endpoint && s.model && navigator.onLine;
  }

  function scrollBottom() {
    chat.scrollTop = chat.scrollHeight;
  }

  function addUser(text) {
    const b = document.createElement("div");
    b.className = "bubble bubble-user";
    b.textContent = text;
    chat.appendChild(b);
    scrollBottom();
  }

  function addAssistant(r) {
    const b = document.createElement("div");
    b.className = `bubble bubble-assistant${r.kind ? " kind-" + r.kind : ""}`;
    const body = document.createElement("div");
    body.textContent = r.text;
    b.appendChild(body);
    if (r.sources && r.sources.length) {
      const sw = document.createElement("div");
      sw.className = "bubble-sources";
      r.sources.slice(0, 3).forEach((s) => {
        const sp = document.createElement("span");
        sp.innerHTML = `《${escapeHtml(s.docName)}》${escapeHtml(s.section)} 相似度 <b>${Number(s.score).toFixed(2)}</b>`;
        sw.appendChild(sp);
      });
      b.appendChild(sw);
    }
    chat.appendChild(b);
    scrollBottom();
  }

  function persistConversation() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        fallbackCount: session.fallbackCount,
        history: history.slice(-12),
        messages: messages.slice(-40)
      }));
      if (window.Auth && window.Auth.isLoggedIn) {
        window.Auth.scheduleSync(STORAGE_KEY);
      }
    } catch { /* 忽略本地存储写入失败 */ }
  }

  function restoreConversation() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || !Array.isArray(saved.messages) || !saved.messages.length) return false;
      session.fallbackCount = Number(saved.fallbackCount) || 0;
      history.length = 0;
      history.push(...(saved.history || []));
      messages.length = 0;
      messages.push(...saved.messages);
      chat.innerHTML = "";
      messages.forEach((message) => {
        if (message.role === "user") {
          addUser(message.text);
        } else {
          addAssistant({ text: message.text, kind: message.kind, sources: message.sources || [] });
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  function welcome() {
    chat.innerHTML = "";
    history.length = 0;
    messages.length = 0;
    chatResult = null;
    addAssistant({
      kind: "chat",
      text: "你好呀！我是你的品牌营销助手 🎬\n\n不管是刚起步不知道怎么做，还是已有产品想优化视频内容，都可以跟我聊——我可以帮你理定位、想卖点、讨论文案方向。\n\n你现在是什么情况？随便说几句就行，我来帮你出思路。",
      sources: []
    });
    persistConversation();
  }

  async function submit(raw) {
    const query = String(raw || "").trim();
    if (!query) return;
    addUser(query);
    input.value = "";
    messages.push({ role: "user", text: query });
    chatResult = null;

    // 本地编排（兜底基线，离线可用）
    let r = window.Knowledge.runAdvisor(query, session);

    // 在线增强：只要在线可用，所有问题都优先走大模型
    // 统一带对话历史，检索片段作为 RAG 参考拼进消息
    if (onlineReady()) {
      try {
        const settings = readSettings();
        const intent = window.Knowledge.detectIntent(query);

        // 拒答类不走在线（违规/隐私），直接用本地判断
        if (intent.type !== "refuse" && intent.type !== "privacy") {
          // 检索相关片段作为 RAG 参考
          const hits = window.Knowledge.search(query, 3).filter((h) => h.score >= 0.55);

          // 统一用带上下文的对话接口
          const o = await window.Knowledge.onlineChatWithContext(query, settings, history, hits);

          const cc = o.compliance || window.Knowledge.complianceCheck(o.text);
          let text = o.text;
          if (!cc.passed) {
            const w = [...new Set(cc.hits.map((x) => x.word))].join("、");
            text += `\n\n💡 小提醒：检测到「${w}」这类极限词，广告里要注意替换哦。`;
          }

          // 在线模式成功 → 用在线结果替换本地结果
          r = {
            kind: "chat",
            text,
            sources: hits.map((h) => ({
              docName: h.chunk.docName, section: h.chunk.section, score: h.score
            }))
          };
        }
      } catch (e) {
        console.warn("Online advisor failed, use local:", e);
      }
    }

    // 记录对话历史
    history.push({ role: "user", content: query });
    history.push({ role: "assistant", content: r.text });
    if (history.length > 12) history.shift(); // 保留最近 6 轮

    // 离线模式：从对话中提取产品信息存入 session，供后续上下文使用
    if (!onlineReady() || r.kind === "chat") {
      extractProductToSession(query, session);
    }

    addAssistant(r);
    messages.push({ role: "assistant", text: r.text, kind: r.kind, sources: r.sources || [] });
    persistConversation();
  }

  // 从用户输入中提取产品/行业信息，存入 session 作为上下文
  function extractProductToSession(text, session) {
    const s = String(text);
    const products = ["咖啡","奶茶","护肤","面膜","健身","瑜伽","手机壳","零食","宠物","母婴","服装","内衣","酒店","旅游","课程","蛋糕","烘焙","茶饮","美妆","香水"];
    for (const p of products) {
      if (s.includes(p)) {
        session.product = p;
        break;
      }
    }
    // 提取目标人群线索
    if (/学生|大学生|校园/.test(s)) session.audience = "学生";
    else if (/上班族|通勤|白领|职场/.test(s)) session.audience = "上班族";
    else if (/宝妈|妈妈|育儿/.test(s)) session.audience = "宝妈";
    else if (/女生|女性|精致/.test(s)) session.audience = "年轻女性";
  }

  function notify(message, type = "info") {
    if (window.BrandFlow && window.BrandFlow.showToast) window.BrandFlow.showToast(message, type);
  }

  function transcriptText() {
    return messages
      .filter((message) => message.text)
      .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.text}`)
      .join("\n");
  }

  function sessionBrief() {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const text = lastUser ? lastUser.text : "";
    return {
      brandName: session.brand || "我的品牌",
      productName: session.product || "我的产品",
      category: session.category || "食品饮料",
      description: session.description || text.slice(0, 120) || "为品质生活打造的创新产品。",
      audience: session.audience || "追求品质的年轻消费者",
      sellingPoints: session.sellingPoints || [],
      tone: session.tone || "vitality",
      direction: session.direction || "product",
      aspectRatio: session.aspectRatio || "16:9"
    };
  }

  async function ensureChatResult() {
    if (chatResult) return chatResult;
    const settings = readSettings();
    let brief = null;
    let content = null;

    if (onlineReady() && window.BrandFlow) {
      try {
        const systemPrompt = [
          "你是品牌宣传视频策划助手。",
          "根据用户与知识助手的对话，提炼品牌创意并生成完整中文宣传脚本。",
          "只返回 JSON，不要 Markdown 代码块。",
          "brief.tone 只能是 vitality/tech/premium/promo。brief.direction 只能是 product/lifestyle/story。brief.aspectRatio 只能是 16:9/9:16/1:1。",
          '结构：{"brief":{"brandName":"","productName":"","category":"","description":"","audience":"","sellingPoints":[""],"tone":"vitality","direction":"product","aspectRatio":"16:9"},"content":{"title":"","tagline":"","summary":"","sellingPoints":[],"narrations":[""],"shots":[{"scene":"","subtitle":"","narration":"","duration":4.5,"background":"studio","transition":"渐隐","motion":"still"}]}}',
          "content 必须包含 6 个分镜，duration 为 4 到 6 秒，background 只能是 studio/tech/nature/retail。motion 只能是 still/pushIn/pullOut/panLeft/panRight/tiltUp/tiltDown。"
        ].join("\n");
        const raw = await window.BrandFlow.requestChatCompletion(settings, [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcriptText() }
        ], { temperature: 0.75 });
        const parsed = window.BrandFlow.parseJsonLoose(raw);
        brief = parsed.brief || {};
        content = parsed.content || parsed;
        if (!Array.isArray(content.shots) || !content.shots.length) content = null;
      } catch (error) {
        console.warn("Chat generation failed, use local:", error);
      }
    }

    if (!content) {
      brief = sessionBrief();
      content = window.BrandFlow ? window.BrandFlow.offlineGenerate(brief, Date.now() % 997) : null;
    }

    chatResult = { brief, content };
    return chatResult;
  }

  async function generateScriptFromChat() {
    if (!messages.length) {
      addAssistant({ kind: "chat", text: "先跟我聊聊你的产品、目标人群和想表达的方向，我再帮你生成脚本。", sources: [] });
      return;
    }
    notify("正在生成宣传脚本…");
    try {
      const { brief, content } = await ensureChatResult();
      window.BrandFlow.applyConversationResult(brief, content);
      notify("宣传脚本已生成，已切换到“分镜脚本”", "success");
      window.BrandFlow.showStep("content");
    } catch (error) {
      console.error(error);
      addAssistant({ kind: "fallback", text: `生成脚本失败：${error.message || "请稍后再试"}`, sources: [] });
    }
  }

  async function generatePosterFromChat() {
    if (!messages.length) {
      addAssistant({ kind: "chat", text: "先跟我聊聊你的产品，我再帮你生成海报配图。", sources: [] });
      return;
    }
    notify("正在生成海报配图…");
    try {
      const { brief, content } = await ensureChatResult();
      const canvas = await window.BrandFlow.generatePosterCanvas(brief, content);
      const dataUrl = canvas.toDataURL("image/png");
      const label = `${brief.productName || brief.brandName || "品牌"}海报`;
      addImageCard(dataUrl, label, "brand-poster.png");
      if (window.BrandFlow.addGeneratedBackground) {
        await window.BrandFlow.addGeneratedBackground(dataUrl, label);
        notify("已添加到背景替换，可在“主体抠像与背景替换”中使用", "success");
        window.BrandFlow.showStep("compose");
      }
    } catch (error) {
      console.error(error);
      addAssistant({ kind: "fallback", text: `生成配图失败：${error.message || "请稍后再试"}`, sources: [] });
    }
  }

  function openImagePreview(dataUrl, label, filename) {
    const existing = document.querySelector(".image-preview-backdrop");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "image-preview-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");

    const dialog = document.createElement("div");
    dialog.className = "image-preview-dialog";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "image-preview-close";
    close.setAttribute("aria-label", "关闭");
    close.textContent = "\u00d7";

    const img = document.createElement("img");
    img.className = "image-preview-image";
    img.src = dataUrl;
    img.alt = label;

    const caption = document.createElement("div");
    caption.className = "image-preview-caption";
    caption.textContent = label;

    const download = document.createElement("a");
    download.className = "image-preview-download";
    download.href = dataUrl;
    download.download = filename || "brand-poster.png";
    download.textContent = "下载图片";

    dialog.appendChild(img);
    dialog.appendChild(caption);
    dialog.appendChild(download);
    backdrop.appendChild(close);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const closePreview = () => {
      backdrop.remove();
      window.removeEventListener("keydown", onKey);
    };
    const onKey = (event) => {
      if (event.key === "Escape") closePreview();
    };
    close.addEventListener("click", closePreview);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closePreview();
    });
    window.addEventListener("keydown", onKey);
  }

  function addImageCard(dataUrl, label, filename) {
    const b = document.createElement("div");
    b.className = "bubble bubble-assistant kind-image";
    const img = document.createElement("img");
    img.className = "advisor-image";
    img.src = dataUrl;
    img.alt = label;
    img.title = "点击放大";
    img.tabIndex = 0;
    img.addEventListener("click", () => openImagePreview(dataUrl, label, filename));
    img.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openImagePreview(dataUrl, label, filename);
      }
    });

    const caption = document.createElement("div");
    caption.className = "bubble-image-caption";
    const captionText = document.createElement("span");
    captionText.textContent = label;

    const actions = document.createElement("div");
    actions.className = "bubble-image-actions";

    const zoom = document.createElement("button");
    zoom.type = "button";
    zoom.className = "text-button bubble-download";
    zoom.textContent = "放大查看";
    zoom.addEventListener("click", () => openImagePreview(dataUrl, label, filename));

    const download = document.createElement("button");
    download.type = "button";
    download.className = "text-button bubble-download";
    download.textContent = "下载图片";
    download.addEventListener("click", () => {
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });

    actions.appendChild(zoom);
    actions.appendChild(download);
    caption.appendChild(captionText);
    caption.appendChild(actions);
    b.appendChild(img);
    b.appendChild(caption);
    chat.appendChild(b);
    scrollBottom();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit(input.value);
  });
  samples.addEventListener("click", (e) => {
    const chip = e.target.closest(".advisor-chip");
    if (chip) submit(chip.textContent);
  });
  clearBtn.addEventListener("click", () => {
    session.fallbackCount = 0;
    welcome();
  });

  if (scriptBtn) {
    scriptBtn.addEventListener("click", generateScriptFromChat);
  }
  if (posterBtn) {
    posterBtn.addEventListener("click", generatePosterFromChat);
  }

  if (!restoreConversation()) {
    welcome();
  }
})();
