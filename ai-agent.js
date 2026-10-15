/* ============================================================
   ai-agent.js
   محرك AI Agent — Function Calling + SQL + Rate Limiting
   الإصدار: 4.1.0 — Rate-Limit Optimized
   ============================================================ */

window.AIAgent = (function () {
  'use strict';

  // ============================================================
  // 🔍 فحص المتطلبات
  // ============================================================
  const Config = window.AI_CONFIG;
  if (!Config) {
    console.error('[AIAgent] ❌ ai-config.js مش محمّل!');
    return null;
  }

  const VERSION = '4.1.0';

  // ============================================================
  // 🔧 الحالة الداخلية
  // ============================================================
  const state = {
    // الواجهة
    isOpen: false,
    isReady: false,
    isGenerating: false,
    isFullscreen: false,

    // المستخدم
    session: null,
    companyId: null,
    userId: null,
    userName: null,
    userRole: 'employee',

    // المحادثة
    currentPersona: 'general',
    messages: [],

    // الصوت
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],
    currentAudio: null,

    // التحكم
    abortController: null,
    lastRequestTime: 0,
    requestCount: 0,

    // عناصر DOM
    container: null,
    panelEl: null,
    messagesEl: null,
    inputEl: null,
    sendBtn: null,
    micBtn: null,
    personasBar: null,
    suggestionsEl: null,
    headerSub: null,
    roleBadge: null,
    fullscreenBtn: null,

    // Supabase client
    sb: null,

    // التخزين
    storageKey: Config.SETTINGS.storage.historyKey
  };

  // ============================================================
  // ⏱️ RATE LIMIT TRACKER
  // ============================================================
  const rateLimiter = {
    // نافذة الـ tokens
    tokens: {
      used: 0,
      windowStart: Date.now(),
      windowMs: Config.SETTINGS.rateLimitGuard.windowMs,
      limit: Config.SETTINGS.rateLimitGuard.maxTokensPerMinute
    },

    // آخر استدعاء
    lastCall: 0,
    minInterval: Config.SETTINGS.rateLimitGuard.minIntervalMs,

    // إحصائيات
    stats: {
      totalCalls: 0,
      totalTokens: 0,
      retries: 0,
      blocked: 0
    },

    /**
     * إعادة ضبط النافذة لو انتهت
     */
    resetWindowIfNeeded: function () {
      const now = Date.now();
      if (now - this.tokens.windowStart >= this.tokens.windowMs) {
        console.log('[AIAgent] ⏱️ Token window reset. Previous: ' + this.tokens.used);
        this.tokens.used = 0;
        this.tokens.windowStart = now;
      }
    },

    /**
     * تقدير tokens من نص
     */
    estimateTokens: function (text) {
      return Math.ceil(String(text || '').length / 3.5);
    },

    /**
     * حساب حجم الـ payload
     */
    estimatePayloadTokens: function (payload) {
      try {
        const json = JSON.stringify(payload);
        return this.estimateTokens(json);
      } catch (e) {
        return 1000; // default
      }
    },

    /**
     * التحقق لو ممكن ننفذ الطلب
     */
    canProceed: function (estimatedTokens) {
      this.resetWindowIfNeeded();

      const wouldUse = this.tokens.used + estimatedTokens;
      return {
        ok: wouldUse <= this.tokens.limit,
        used: this.tokens.used,
        wouldUse: wouldUse,
        limit: this.tokens.limit,
        waitMs: wouldUse > this.tokens.limit
          ? this.tokens.windowMs - (Date.now() - this.tokens.windowStart)
          : 0
      };
    },

    /**
     * انتظار قبل الطلب
     */
    waitIfNeeded: async function (estimatedTokens) {
      const self = this;

      // 1) انتظر الحد الأدنى بين الطلبات
      const now = Date.now();
      const timeSinceLast = now - self.lastCall;
      if (timeSinceLast < self.minInterval) {
        const waitMs = self.minInterval - timeSinceLast;
        console.log('[AIAgent] ⏱️ Waiting ' + waitMs + 'ms between calls');
        await sleep(waitMs);
      }

      // 2) فحص الـ tokens
      let check = self.canProceed(estimatedTokens);

      while (!check.ok) {
        const waitMs = Math.max(check.waitMs, 1000);
        console.log(
          '[AIAgent] ⏱️ Token budget exceeded (' +
          check.wouldUse + ' > ' + check.limit + '). Waiting ' +
          Math.round(waitMs / 1000) + 's...'
        );

        toast('⏳ الحمل عالي، استنى ' + Math.round(waitMs / 1000) + ' ثانية...', 'warning');
        await sleep(waitMs);

        self.resetWindowIfNeeded();
        check = self.canProceed(estimatedTokens);
      }

      // 3) تحذير لو قربنا
      const usage = check.wouldUse / check.limit;
      if (usage >= Config.SETTINGS.rateLimitGuard.warningThreshold) {
        console.warn(
          '[AIAgent] ⚠️ Token usage high: ' +
          Math.round(usage * 100) + '% (' +
          check.wouldUse + '/' + check.limit + ')'
        );
      }
    },

    /**
     * سجّل الاستدعاء
     */
    recordCall: function (estimatedTokens) {
      this.lastCall = Date.now();
      this.tokens.used += estimatedTokens;
      this.stats.totalCalls++;
      this.stats.totalTokens += estimatedTokens;

      const usage = (this.tokens.used / this.tokens.limit * 100).toFixed(0);
      console.log(
        '[AIAgent] 📊 Tokens: ' + this.tokens.used + '/' + this.tokens.limit +
        ' (' + usage + '%)'
      );
    },

    /**
     * الحصول على حالة
     */
    getStatus: function () {
      this.resetWindowIfNeeded();
      return {
        used: this.tokens.used,
        limit: this.tokens.limit,
        remaining: this.tokens.limit - this.tokens.used,
        percent: Math.round(this.tokens.used / this.tokens.limit * 100),
        stats: { ...this.stats }
      };
    }
  };

  // ============================================================
  // 🛠️ Helpers عامة
  // ============================================================
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(date) {
    const d = new Date(date);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function toast(msg, type) {
    if (window.Refad && Refad.toast) {
      if (type === 'error') Refad.toast.error(msg);
      else if (type === 'warning') Refad.toast.warning(msg);
      else if (type === 'success') Refad.toast.success(msg);
      else Refad.toast.info(msg);
    } else {
      console.log('[AIAgent toast]', type, msg);
    }
  }

  function cleanMarkdown(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^[\-\*]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getModelShortName(modelId) {
    const info = Config.getModelInfo(modelId);
    return info ? info.label : modelId;
  }

  // ============================================================
  // 🎨 Markdown Parser
  // ============================================================
  function simpleMarkdown(text) {
    if (!text) return '';

    let html = esc(text);

    html = html.replace(/```([\s\S]*?)```/g, function (m, code) {
      return '<pre class="ai-code">' + code.trim() + '</pre>';
    });

    html = html.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|\s)\*([^*\n]+)\*(\s|$)/g, '$1<em>$2</em>$3');

    html = html.replace(/^#### (.*)$/gm, '<h4 class="ai-h4">$1</h4>');
    html = html.replace(/^### (.*)$/gm, '<h4 class="ai-h4">$1</h4>');
    html = html.replace(/^## (.*)$/gm, '<h3 class="ai-h3">$1</h3>');
    html = html.replace(/^# (.*)$/gm, '<h2 class="ai-h2">$1</h2>');

    html = html.replace(/^[\-\*] (.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, function (m) {
      if (m.indexOf('<ul') === -1) {
        return '<ul class="ai-ul">' + m + '</ul>';
      }
      return m;
    });

    html = html.replace(/^\d+\. (.*)$/gm, '<li>$1</li>');
    html = html.replace(/\n/g, '<br>');

    html = html.replace(/<\/li><br>/g, '</li>');
    html = html.replace(/<br><li>/g, '<li>');
    html = html.replace(/<\/ul><br>/g, '</ul>');
    html = html.replace(/<br><ul/g, '<ul');
    html = html.replace(/<pre class="ai-code">([\s\S]*?)<\/pre>/g, function (m, code) {
      return '<pre class="ai-code">' + code.replace(/<br>/g, '\n') + '</pre>';
    });

    return html;
  }

  // ============================================================
  // 💾 LocalStorage
  // ============================================================
  function loadHistory() {
    try {
      const raw = localStorage.getItem(state.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.slice(-Config.SETTINGS.storage.maxSavedMessages)
        : [];
    } catch (e) {
      console.warn('[AIAgent] loadHistory failed:', e);
      return [];
    }
  }

  function saveHistory() {
    try {
      const toSave = state.messages
        .filter(function (m) {
          return m.role === 'user' || (m.role === 'assistant' && m.content);
        })
        .slice(-Config.SETTINGS.storage.maxSavedMessages)
        .map(function (m) {
          return {
            role: m.role,
            content: m.content,
            persona: m.persona,
            time: m.time,
            model: m.model
          };
        });
      localStorage.setItem(state.storageKey, JSON.stringify(toSave));
    } catch (e) {
      console.warn('[AIAgent] saveHistory failed:', e);
    }
  }

  function clearHistory() {
    if (!confirm('هل تريد حذف كل المحادثة؟')) return;
    state.messages = [];
    localStorage.removeItem(state.storageKey);
    renderMessages();
    bindMessageActions();
    console.log('[AIAgent] History cleared');
  }

  // ============================================================
  // 💾 Fullscreen localStorage
  // ============================================================
  function loadFullscreenPref() {
    try {
      return localStorage.getItem(Config.SETTINGS.storage.fullscreenKey) === 'true';
    } catch (e) {
      return false;
    }
  }

  function saveFullscreenPref(value) {
    try {
      localStorage.setItem(Config.SETTINGS.storage.fullscreenKey, String(value));
    } catch (e) {}
  }

  // ============================================================
  // 🔐 الصلاحيات
  // ============================================================
  function getUserRole() {
    if (!state.session) return 'employee';
    if (state.session.is_owner === true) return 'owner';
    if (window.Refad && Refad.Session) {
      if (Refad.Session.has('company.owner')) return 'owner';
      if (Refad.Session.has('admin.full')) return 'manager';
    }
    return 'employee';
  }

  function canUseAI() {
    return state.userRole === 'owner' || state.userRole === 'manager';
  }

  // ============================================================
  // 🔌 Supabase Init
  // ============================================================
  function initSupabase() {
    try {
      if (window.Refad && window.Refad.sb) {
        state.sb = window.Refad.sb;
        console.log('[AIAgent] ✅ Using Refad.sb');
        return true;
      }
      if (window.supabase && window.REFAD_CONFIG) {
        state.sb = window.supabase.createClient(
          window.REFAD_CONFIG.SUPABASE_URL,
          window.REFAD_CONFIG.SUPABASE_ANON_KEY
        );
        console.log('[AIAgent] ✅ Created Supabase client');
        return true;
      }
      console.warn('[AIAgent] ⚠️ No Supabase client available');
      return false;
    } catch (e) {
      console.error('[AIAgent] Supabase init failed:', e);
      return false;
    }
  }

  // ============================================================
  // 🗄️ SQL Execution
  // ============================================================
  async function executeSQL(rawQuery, reason) {
    if (!state.sb) {
      return { success: false, error: 'Supabase client مش جاهز' };
    }

    const sanitized = Config.sanitizeQuery(rawQuery, state.companyId);
    if (sanitized.error) {
      console.warn('[AIAgent] ❌ Query rejected:', sanitized.error);
      return { success: false, error: sanitized.error };
    }

    const query = sanitized.query;
    console.log('[AIAgent] 🔍 Executing SQL:', query);
    if (reason) console.log('[AIAgent] 💡 Reason:', reason);

    try {
      const startTime = performance.now();

      const { data, error } = await state.sb.rpc('ai_execute_query', {
        p_company_id: state.companyId,
        p_query: query
      });

      const duration = Math.round(performance.now() - startTime);

      if (error) {
        console.error('[AIAgent] ❌ SQL error:', error);
        return {
          success: false,
          error: error.message || 'SQL execution failed',
          query: query
        };
      }

      if (!data || !data.success) {
        return {
          success: false,
          error: (data && data.error) || 'Query failed',
          query: query
        };
      }

      console.log('[AIAgent] ✅ SQL OK (' + duration + 'ms):', data.row_count + ' rows');

      return {
        success: true,
        data: data.data || [],
        row_count: data.row_count || 0,
        query: query,
        duration: duration
      };

    } catch (e) {
      console.error('[AIAgent] SQL execution failed:', e);
      return {
        success: false,
        error: e.message || 'Unknown error',
        query: query
      };
    }
  }

  // ============================================================
  // 🛠️ Tool Executor
  // ============================================================
  async function executeTool(toolName, args) {
    console.log('[AIAgent] 🔧 Tool called:', toolName, args);

    switch (toolName) {
      case 'query_database':
        return await toolQueryDatabase(args);
      case 'count_records':
        return await toolCountRecords(args);
      default:
        return { success: false, error: 'Unknown tool: ' + toolName };
    }
  }

  async function toolQueryDatabase(args) {
    if (!args || !args.query) {
      return { success: false, error: 'Missing query parameter' };
    }
    return await executeSQL(args.query, args.reason);
  }

  async function toolCountRecords(args) {
    const table = String(args.table || '').trim();
    const filters = args.filters || {};

    if (!table) {
      return { success: false, error: 'Missing table parameter' };
    }

    const conditions = [];
    Object.keys(filters).forEach(function (key) {
      const val = filters[key];
      if (typeof val === 'number') {
        conditions.push(key + ' = ' + val);
      } else if (typeof val === 'string') {
        conditions.push(key + " = '" + val.replace(/'/g, "''") + "'");
      } else if (typeof val === 'boolean') {
        conditions.push(key + ' = ' + (val ? 'true' : 'false'));
      }
    });

    conditions.push('company_id = ' + state.companyId);

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const sql = 'SELECT COUNT(*) as count FROM ' + table + ' ' + whereClause;

    return await executeSQL(sql, 'Count records in ' + table);
  }

  // ============================================================
  // 🎭 الشخصيات
  // ============================================================
  function getAvailablePersonas() {
    return Config.getPersonasForRole(state.userRole);
  }

  function setPersona(personaId) {
    const persona = Config.PERSONAS[personaId];
    if (!persona) return;

    if (!Config.canAccessPersona(personaId, state.userRole)) {
      toast('مش مسموحلك تستخدم الشخصية دي', 'error');
      return;
    }

    state.currentPersona = personaId;
    renderPersonasBar();
    renderSuggestions();
    updateHeaderSub();

    console.log('[AIAgent] Persona →', persona.name);
  }

  function updateHeaderSub(text) {
    if (!state.headerSub) return;
    if (text) {
      state.headerSub.textContent = text;
      return;
    }
    const persona = Config.PERSONAS[state.currentPersona];
    if (persona) {
      state.headerSub.textContent = persona.emoji + ' ' + persona.name + ' جاهز';
    }
  }

  // ⏭️ الجزء 4 (Streaming + Function Calling + UI) هيتحط هنا

    // ============================================================
  // 🌊 Streaming مع Function Calling + Rate Limiting
  // ============================================================
  async function streamCompletionWithTools(userText, assistantIdx) {
    const persona = Config.PERSONAS[state.currentPersona] || Config.PERSONAS.general;
    const model = Config.selectModel(userText, persona);

    console.log('[AIAgent] → Model:', model, '| Persona:', persona.name, '| Tools:', Config.modelSupportsTools(model));

    const contextMessages = buildContextMessages(userText, persona);

    state.abortController = new AbortController();
    const timeoutId = setTimeout(function () {
      state.abortController.abort();
    }, Config.GROQ_CONFIG.TIMEOUT.chatWithTools);

    try {
      const finalContent = await runFunctionCallingLoop(
        model,
        contextMessages,
        assistantIdx
      );

      state.messages[assistantIdx].content = finalContent;
      state.messages[assistantIdx].model = model;
      state.messages[assistantIdx]._complete = true;
      renderMessages();
      bindMessageActions();

    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        throw new Error('الرد خد وقت طويل — حاول تاني');
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================================
  // 🔄 Function Calling Loop — مع Retry + Rate Limiting
  // ============================================================
  async function runFunctionCallingLoop(model, initialMessages, assistantIdx) {
    const messages = [...initialMessages];
    let iteration = 0;
    const maxIterations = Config.SETTINGS.functionCalling.maxIterations;
    const supportsTools = Config.modelSupportsTools(model);
    const maxRetries = Config.GROQ_CONFIG.RETRY.maxAttempts;

    console.log('[AIAgent] Tool support:', supportsTools);
    console.log('[AIAgent] Max iterations:', maxIterations);

    while (iteration < maxIterations) {
      iteration++;
      console.log('[AIAgent] 🔄 Iteration', iteration, '/', maxIterations);

      // بناء الـ payload
      const payload = {
        model: model,
        messages: messages,
        stream: false,
        temperature: 0.3,
        max_tokens: Config.SETTINGS.functionCalling.maxTokensPerCall, // ← 1000
        top_p: 0.9
      };

      if (supportsTools && Config.SETTINGS.functionCalling.enabled) {
        payload.tools = Config.TOOLS;
        payload.tool_choice = Config.SETTINGS.functionCalling.toolChoice;
      }

      // ⏱️ Rate Limiting Guard
      const estimatedTokens = rateLimiter.estimatePayloadTokens(payload);
      console.log('[AIAgent] 📊 Estimated tokens: ' + estimatedTokens);

      await rateLimiter.waitIfNeeded(estimatedTokens);
      rateLimiter.recordCall(estimatedTokens);

      // 🔄 Retry Loop على 429
      let response = null;
      let lastError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const url = Config.GROQ_CONFIG.BASE_URL + Config.GROQ_CONFIG.CHAT_ENDPOINT;

          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + Config.GROQ_CONFIG.API_KEY
            },
            body: JSON.stringify(payload),
            signal: state.abortController.signal
          });

          // ✅ نجح
          if (response.ok) break;

          // ❌ 429 — Rate Limit
          if (response.status === 429) {
            const errText = await response.text();
            console.warn('[AIAgent] ⚠️ 429 Rate Limit (attempt ' + attempt + '/' + maxRetries + ')');

            // احسب وقت الانتظار من الـ header لو موجود
            let waitMs = Config.GROQ_CONFIG.RETRY.baseDelayMs;

            const retryAfter = response.headers.get('retry-after');
            if (retryAfter) {
              waitMs = parseInt(retryAfter, 10) * 1000;
            } else {
              // Exponential backoff
              waitMs = Config.GROQ_CONFIG.RETRY.baseDelayMs *
                       Math.pow(Config.GROQ_CONFIG.RETRY.backoffMultiplier, attempt - 1);
            }

            waitMs = Math.min(waitMs, Config.GROQ_CONFIG.RETRY.maxDelayMs);

            if (attempt < maxRetries) {
              rateLimiter.stats.retries++;
              console.log('[AIAgent] ⏱️ Waiting ' + Math.round(waitMs / 1000) + 's before retry...');
              toast('⏳ الحمل عالي، جاري إعادة المحاولة...', 'warning');
              await sleep(waitMs);
              continue;
            }

            lastError = new Error('Rate limit reached after ' + maxRetries + ' attempts');
            break;
          }

          // ❌ أخطاء تانية
          const errText = await response.text();

          // 400 — tool_use_failed
          if (response.status === 400 && errText.includes('tool_use_failed')) {
            console.warn('[AIAgent] ⚠️ tool_use_failed — retrying WITHOUT tools');
            delete payload.tools;
            delete payload.tool_choice;

            // إعادة المحاولة مرة واحدة بدون tools
            const retryUrl = Config.GROQ_CONFIG.BASE_URL + Config.GROQ_CONFIG.CHAT_ENDPOINT;
            const retryRes = await fetch(retryUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + Config.GROQ_CONFIG.API_KEY
              },
              body: JSON.stringify(payload),
              signal: state.abortController.signal
            });

            if (retryRes.ok) {
              response = retryRes;
              break;
            }

            lastError = new Error('tool_use_failed retry failed');
            break;
          }

          // أخطاء تانية
          throw new Error('Groq API: ' + response.status + ' — ' + errText.slice(0, 200));

        } catch (e) {
          if (e.name === 'AbortError') throw e;

          console.error('[AIAgent] ❌ Attempt ' + attempt + ' failed:', e.message);
          lastError = e;

          if (attempt < maxRetries) {
            const waitMs = Config.GROQ_CONFIG.RETRY.baseDelayMs *
                          Math.pow(Config.GROQ_CONFIG.RETRY.backoffMultiplier, attempt - 1);
            await sleep(Math.min(waitMs, Config.GROQ_CONFIG.RETRY.maxDelayMs));
            continue;
          }
        }
      }

      // فحص النتيجة النهائية
      if (!response || !response.ok) {
        throw lastError || new Error('Request failed after retries');
      }

      // قراءة الرد
      const data = await response.json();
      const choice = data.choices && data.choices[0];
      if (!choice) {
        throw new Error('No response from Groq');
      }

      const assistantMessage = choice.message;
      console.log('[AIAgent] ← finish_reason:', choice.finish_reason);

      // 1) tool_calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log('[AIAgent] 🛠️ Tool calls:', assistantMessage.tool_calls.length);

        showToolCallIndicator(assistantIdx, assistantMessage.tool_calls);

        messages.push({
          role: 'assistant',
          content: assistantMessage.content || null,
          tool_calls: assistantMessage.tool_calls
        });

        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs = {};

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.warn('[AIAgent] Failed to parse tool args:', e);
          }

          const result = await executeTool(toolName, toolArgs);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });

          showToolResult(assistantIdx, toolName, result);
        }

        continue;
      }

      // 2) الرد النهائي
      if (assistantMessage.content) {
        console.log('[AIAgent] ✅ Final response');
        removeToolCallIndicator(assistantIdx);
        await typewriterEffect(assistantIdx, assistantMessage.content);
        return assistantMessage.content;
      }

      throw new Error('Empty response from AI');
    }

    throw new Error('Max iterations reached — AI مش قادر يخلّص');
  }

  // ============================================================
  // 📝 Typewriter Effect
  // ============================================================
  async function typewriterEffect(idx, fullText) {
    if (!state.messagesEl) return;

    state.messages[idx].content = fullText;

    const msgEl = state.messagesEl.querySelector('.ai-msg[data-idx="' + idx + '"] .ai-msg-content');
    if (!msgEl) {
      renderMessages();
      bindMessageActions();
      return;
    }

    const chunkSize = 20;
    let current = '';
    for (let i = 0; i < fullText.length; i += chunkSize) {
      current += fullText.slice(i, i + chunkSize);
      msgEl.innerHTML = simpleMarkdown(current);
      scrollToBottom();
      await sleep(15);
    }

    msgEl.innerHTML = simpleMarkdown(fullText);
    scrollToBottom();
  }

  // ============================================================
  // 🛠️ Tool Indicators
  // ============================================================
  function showToolCallIndicator(idx, toolCalls) {
    if (!state.messagesEl) return;

    const msgEl = state.messagesEl.querySelector('.ai-msg[data-idx="' + idx + '"] .ai-msg-content');
    if (!msgEl) return;

    const toolNames = toolCalls.map(function (tc) {
      return tc.function.name;
    });

    const html =
      '<div class="ai-tool-indicator">' +
        '<span class="ai-tool-spinner">⏳</span>' +
        '<span>جاري البحث في البيانات...</span>' +
        '<div class="ai-tool-names">' +
          toolNames.map(function (name) {
            return '<span class="ai-tool-chip">🔧 ' + esc(name) + '</span>';
          }).join('') +
        '</div>' +
      '</div>';

    msgEl.innerHTML = html;
    scrollToBottom();
  }

  function showToolResult(idx, toolName, result) {
    if (!state.messagesEl) return;

    const msgEl = state.messagesEl.querySelector('.ai-msg[data-idx="' + idx + '"] .ai-msg-content');
    if (!msgEl) return;

    if (!msgEl.querySelector('.ai-tool-indicator')) {
      msgEl.innerHTML = '<div class="ai-tool-indicator"></div>';
    }

    const indicator = msgEl.querySelector('.ai-tool-indicator');
    const icon = result.success ? '✅' : '❌';
    const status = result.success ? (result.row_count || 0) + ' صف' : (result.error || 'فشل');
    const duration = result.duration ? ' (' + result.duration + 'ms)' : '';

    const chip = document.createElement('div');
    chip.className = 'ai-tool-result ' + (result.success ? 'success' : 'error');
    chip.innerHTML =
      '<span>' + icon + '</span>' +
      '<span class="ai-tool-result-name">' + esc(toolName) + '</span>' +
      '<span class="ai-tool-result-status">' + esc(status) + duration + '</span>';

    if (indicator) {
      indicator.appendChild(chip);
    }

    scrollToBottom();
  }

  function removeToolCallIndicator(idx) {
    if (!state.messagesEl) return;
    const msgEl = state.messagesEl.querySelector('.ai-msg[data-idx="' + idx + '"] .ai-msg-content');
    if (!msgEl) return;
    const spinner = msgEl.querySelector('.ai-tool-spinner');
    if (spinner) spinner.textContent = '✅';
  }

  // ============================================================
  // 🧠 بناء السياق
  // ============================================================
  function buildContextMessages(userText, persona) {
    const messages = [];

    const systemPrompt = Config.buildSystemPrompt(
      persona.id,
      state.companyId,
      state.userRole
    );
    messages.push({ role: 'system', content: systemPrompt });

    const history = state.messages
      .slice(0, -2)
      .filter(function (m) {
        return m.role === 'user' || (m.role === 'assistant' && m.content);
      })
      .slice(-Config.SETTINGS.context.maxHistory);

    let totalChars = 0;
    const ctxMessages = [];

    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (!m.content || !m.content.trim()) continue;
      const chars = m.content.length;
      if (totalChars + chars > Config.SETTINGS.context.maxHistoryChars) break;
      totalChars += chars;
      ctxMessages.unshift({
        role: m.role,
        content: m.content
      });
    }

    ctxMessages.forEach(function (m) { messages.push(m); });
    messages.push({ role: 'user', content: userText });

    return messages;
  }

  // ============================================================
  // 📨 إرسال الرسالة
  // ============================================================
  async function sendMessage(text) {
    if (state.isGenerating) {
      toast('في رد جاي حالاً — استنى', 'warning');
      return;
    }

    text = String(text || '').trim();
    if (!text) return;

    const validation = Config.isInputValid(text);
    if (!validation.valid) {
      toast(validation.reason === 'too_long' ? 'السؤال طويل جداً' : 'اكتب سؤالك', 'warning');
      return;
    }

    if (!canUseAI()) {
      toast('الميزة دي للمالك والمدير فقط', 'error');
      return;
    }

    const now = Date.now();
    if (now - state.lastRequestTime < Config.SETTINGS.rateLimit.cooldownMs) {
      const wait = Math.ceil((Config.SETTINGS.rateLimit.cooldownMs - (now - state.lastRequestTime)) / 1000);
      toast('استنى ' + wait + ' ثانية', 'warning');
      return;
    }
    state.lastRequestTime = now;

    const autoPersona = Config.selectPersona(text, state.userRole);
    if (autoPersona && autoPersona.id !== state.currentPersona && autoPersona.id !== 'general') {
      state.currentPersona = autoPersona.id;
      renderPersonasBar();
      updateHeaderSub();
    }

    state.messages.push({
      role: 'user',
      content: text,
      time: Date.now()
    });
    renderMessages();
    saveHistory();

    if (state.inputEl) {
      state.inputEl.value = '';
      state.inputEl.style.height = 'auto';
    }

    const assistantIdx = state.messages.length;
    state.messages.push({
      role: 'assistant',
      content: '',
      persona: state.currentPersona,
      time: Date.now(),
      model: null
    });
    renderMessages();
    bindMessageActions();

    state.isGenerating = true;
    updateSendBtn();
    updateHeaderSub('⏳ جاري التحليل...');

    try {
      await streamCompletionWithTools(text, assistantIdx);
    } catch (err) {
      console.error('[AIAgent] streamCompletionWithTools error:', err);
      state.messages[assistantIdx].content = formatError(err);
      renderMessages();
      bindMessageActions();
    } finally {
      state.isGenerating = false;
      updateSendBtn();
      updateHeaderSub();
      saveHistory();
    }
  }

  function formatError(err) {
    const msg = (err && err.message) ? err.message : 'خطأ غير معروف';

    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return '🔑 **مشكلة في API Key**\n\nالـ API key بتاع Groq مش شغال. تأكد من:\n- إنه صحيح\n- إنه مفعّل';
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit')) {
      return '⏱️ **حد الاستخدام**\n\nوصلت للحد. **استنى دقيقة** وجرّب تاني.\n\n💡 نصيحة: اسأل سؤال واحد في المرة.';
    }
    if (msg.includes('network') || msg.includes('fetch')) {
      return '🌐 **مشكلة اتصال**\n\nتأكد من الإنترنت وحاول تاني.';
    }
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      return '🔧 **مشكلة في السيرفر**\n\nGroq بيواجه مشكلة. حاول بعد دقيقة.';
    }
    if (msg.includes('Max iterations')) {
      return '🔄 **التحليل معقّد**\n\nالسؤال محتاج خطوات كتير. جرّب تقسّمه لأسئلة أصغر.';
    }
    if (msg.includes('timeout') || msg.includes('وقت طويل')) {
      return '⏱️ **الرد اتأخر**\n\nالتحليل خد وقت طويل. جرّب سؤال أبسط.';
    }
    if (msg.includes('ai_execute_query') || msg.includes('function')) {
      return '🗄️ **مشكلة في قاعدة البيانات**\n\nتأكد من تشغيل دالة `ai_execute_query` في Supabase.\n\n' + msg;
    }

    return '❌ **خطأ**\n\n' + msg;
  }

  // ============================================================
  // 🎨 Rendering
  // ============================================================
  function renderPersonasBar() {
    if (!state.personasBar) return;
    const personas = getAvailablePersonas();

    state.personasBar.innerHTML = personas.map(function (p) {
      const active = p.id === state.currentPersona ? ' active' : '';
      return '<button type="button" class="ai-persona-btn' + active + '" data-persona="' + esc(p.id) + '" title="' + esc(p.description) + '">' +
        '<span class="ai-persona-emoji">' + p.emoji + '</span>' +
        '<span class="ai-persona-name">' + esc(p.name) + '</span>' +
      '</button>';
    }).join('');

    state.personasBar.querySelectorAll('.ai-persona-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setPersona(btn.dataset.persona);
      });
    });
  }

  function renderSuggestions() {
    if (!state.suggestionsEl) return;
    const suggestions = Config.getSuggestions(state.currentPersona);

    state.suggestionsEl.innerHTML = suggestions.slice(0, 6).map(function (s) {
      return '<button type="button" class="ai-suggestion-btn" data-q="' + esc(s) + '">' + esc(s) + '</button>';
    }).join('');

    state.suggestionsEl.querySelectorAll('.ai-suggestion-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendMessage(btn.dataset.q);
      });
    });
  }

  function renderMessages() {
    if (!state.messagesEl) return;

    if (state.messages.length === 0) {
      state.messagesEl.innerHTML = renderWelcome();
      return;
    }

    state.messagesEl.innerHTML = state.messages.map(function (msg, idx) {
      return renderMessage(msg, idx);
    }).join('');

    scrollToBottom();
  }

  function renderWelcome() {
    const personas = getAvailablePersonas();
    const roleLabel = state.userRole === 'owner' ? 'مالك' : 'مدير';

    return '<div class="ai-welcome">' +
      '<div class="ai-welcome-icon">🤖</div>' +
      '<h3>أهلاً ' + esc((state.userName || '').split(' ')[0]) + ' 👋</h3>' +
      '<p>مساعد رفاد الذكي — متاح للـ <strong>' + roleLabel + '</strong> فقط</p>' +
      '<div class="ai-welcome-features">' +
        '<div class="ai-welcome-feature">' +
          '<span>🔍</span>' +
          '<div><strong>يشوف كل البيانات</strong><small>مبيعات، مخزون، عملاء، شيكات</small></div>' +
        '</div>' +
        '<div class="ai-welcome-feature">' +
          '<span>📊</span>' +
          '<div><strong>تحليل ذكي</strong><small>أرقام حقيقية من قواعد بياناتك</small></div>' +
        '</div>' +
        '<div class="ai-welcome-feature">' +
          '<span>⚡</span>' +
          '<div><strong>ردود فورية</strong><small>بدون الحاجة لفتح صفحات</small></div>' +
        '</div>' +
      '</div>' +
      '<div class="ai-welcome-personas">' +
        personas.map(function (p) {
          return '<div class="ai-welcome-card">' +
            '<div class="ai-welcome-emoji">' + p.emoji + '</div>' +
            '<div class="ai-welcome-info">' +
              '<div class="ai-welcome-name">' + esc(p.name) + '</div>' +
              '<div class="ai-welcome-desc">' + esc(p.description) + '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function renderMessage(msg, idx) {
    const isUser = msg.role === 'user';
    const persona = msg.persona ? Config.PERSONAS[msg.persona] : null;

    if (isUser) {
      return '<div class="ai-msg ai-msg-user" data-idx="' + idx + '">' +
        '<div class="ai-msg-avatar">👤</div>' +
        '<div class="ai-msg-body">' +
          '<div class="ai-msg-content">' + esc(msg.content) + '</div>' +
          '<div class="ai-msg-meta">' +
            (Config.SETTINGS.ui.showTimestamps ? '<span>' + formatTime(msg.time || Date.now()) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }

    const personaName = persona ? persona.name : 'مساعد';
    const personaEmoji = persona ? persona.emoji : '🤖';
    const personaColor = persona ? persona.color : '#14B8A6';

    const showMeta = Config.SETTINGS.ui.showModelName || Config.SETTINGS.ui.showTimestamps;

    return '<div class="ai-msg ai-msg-assistant" data-idx="' + idx + '">' +
      '<div class="ai-msg-avatar" style="background:' + personaColor + ';">' + personaEmoji + '</div>' +
      '<div class="ai-msg-body">' +
        (Config.SETTINGS.ui.showPersonaName
          ? '<div class="ai-msg-persona" style="color:' + personaColor + ';">' + esc(personaName) + '</div>'
          : '') +
        '<div class="ai-msg-content">' + simpleMarkdown(msg.content) + '</div>' +
        (showMeta
          ? '<div class="ai-msg-meta">' +
              (Config.SETTINGS.ui.showTimestamps ? '<span>' + formatTime(msg.time || Date.now()) + '</span>' : '') +
              (Config.SETTINGS.ui.showModelName && msg.model
                ? '<span class="ai-msg-model">' + esc(getModelShortName(msg.model)) + '</span>'
                : '') +
              '<button class="ai-copy-btn" data-copy-idx="' + idx + '" title="نسخ">📋</button>' +
              '<button class="ai-speak-btn" data-speak-idx="' + idx + '" title="اسمع">🔊</button>' +
            '</div>'
          : '') +
      '</div>' +
    '</div>';
  }

  function bindMessageActions() {
    if (!state.messagesEl) return;

    state.messagesEl.querySelectorAll('[data-copy-idx]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        const idx = parseInt(btn.dataset.copyIdx, 10);
        const msg = state.messages[idx];
        if (!msg) return;
        try {
          await navigator.clipboard.writeText(msg.content);
          toast('تم النسخ ✅', 'success');
        } catch (e) {
          toast('فشل النسخ', 'error');
        }
      });
    });

    state.messagesEl.querySelectorAll('[data-speak-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.dataset.speakIdx, 10);
        const msg = state.messages[idx];
        if (!msg) return;
        speakText(msg.content, btn);
      });
    });
  }

  function scrollToBottom() {
    if (state.messagesEl) {
      requestAnimationFrame(function () {
        state.messagesEl.scrollTop = state.messagesEl.scrollHeight;
      });
    }
  }

  // ============================================================
  // 🎤 الصوت
  // ============================================================
  async function startRecording() {
    if (state.isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mediaRecorder = new MediaRecorder(stream);
      state.audioChunks = [];

      state.mediaRecorder.ondataavailable = function (e) {
        if (e.data.size > 0) state.audioChunks.push(e.data);
      };

      state.mediaRecorder.onstop = async function () {
        const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
        stream.getTracks().forEach(function (t) { t.stop(); });
        await transcribeAudio(blob);
      };

      state.mediaRecorder.start();
      state.isRecording = true;
      updateMicBtn();

      setTimeout(function () {
        if (state.isRecording) stopRecording();
      }, 30000);
    } catch (e) {
      console.error('[AIAgent] Mic error:', e);
      toast('مش قادر أوصل للمايك', 'error');
    }
  }

  function stopRecording() {
    if (!state.isRecording || !state.mediaRecorder) return;
    state.mediaRecorder.stop();
    state.isRecording = false;
    updateMicBtn();
  }

  async function transcribeAudio(blob) {
    const original = state.inputEl ? state.inputEl.placeholder : '';
    if (state.inputEl) state.inputEl.placeholder = '⏳ جاري التحويل...';

    try {
      const formData = new FormData();
      formData.append('file', blob, 'recording.webm');
      formData.append('model', Config.MODELS.audio.transcribe);
      formData.append('language', 'ar');
      formData.append('response_format', 'json');

      const url = Config.GROQ_CONFIG.BASE_URL + Config.GROQ_CONFIG.AUDIO_ENDPOINT;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + Config.GROQ_CONFIG.API_KEY },
        body: formData
      });

      if (!response.ok) throw new Error('Transcribe failed: ' + response.status);

      const data = await response.json();
      const text = (data.text || '').trim();

      if (!text) {
        toast('مفيش صوت مسموع', 'warning');
        return;
      }

      if (state.inputEl) {
        state.inputEl.value = text;
        state.inputEl.focus();
      }
      toast('✅ اتحوّل', 'success');
    } catch (e) {
      console.error('[AIAgent] Transcribe error:', e);
      toast('فشل التحويل: ' + e.message, 'error');
    } finally {
      if (state.inputEl) state.inputEl.placeholder = original || 'اكتب سؤالك هنا...';
    }
  }

  async function speakText(text, btn) {
    if (state.currentAudio) {
      state.currentAudio.pause();
      state.currentAudio = null;
      document.querySelectorAll('.ai-speak-btn').forEach(function (b) { b.textContent = '🔊'; });
      return;
    }

    const cleanText = cleanMarkdown(text).slice(0, Config.SETTINGS.voice.maxChars);
    if (!cleanText) return;

    if (btn) btn.textContent = '⏳';

    try {
      const url = Config.GROQ_CONFIG.BASE_URL + Config.GROQ_CONFIG.TTS_ENDPOINT;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + Config.GROQ_CONFIG.API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: Config.MODELS.audio.ttsArabicSaudi,
          input: cleanText,
          voice: Config.SETTINGS.voice.voice,
          response_format: 'mp3'
        })
      });

      if (!response.ok) throw new Error('TTS failed: ' + response.status);

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      state.currentAudio = new Audio(audioUrl);
      state.currentAudio.onended = function () {
        URL.revokeObjectURL(audioUrl);
        state.currentAudio = null;
        if (btn) btn.textContent = '🔊';
      };
      state.currentAudio.onerror = function () {
        state.currentAudio = null;
        if (btn) btn.textContent = '🔊';
      };

      await state.currentAudio.play();
      if (btn) btn.textContent = '⏸️';
    } catch (e) {
      console.error('[AIAgent] Speak error:', e);
      if (btn) btn.textContent = '🔊';
      fallbackSpeak(cleanText);
    }
  }

  function fallbackSpeak(text) {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = Config.SETTINGS.voice.language;
    utterance.rate = 0.95;
    speechSynthesis.speak(utterance);
  }

  // ============================================================
  // 🖥️ Fullscreen
  // ============================================================
  function toggleFullscreen() {
    state.isFullscreen = !state.isFullscreen;
    saveFullscreenPref(state.isFullscreen);
    applyFullscreen();
  }

  function applyFullscreen() {
    if (!state.panelEl) return;
    if (state.isFullscreen) {
      state.panelEl.classList.add('ai-panel-fullscreen');
      document.body.classList.add('ai-fullscreen-active');
    } else {
      state.panelEl.classList.remove('ai-panel-fullscreen');
      document.body.classList.remove('ai-fullscreen-active');
    }
    if (state.fullscreenBtn) {
      state.fullscreenBtn.textContent = '⛶';
      state.fullscreenBtn.title = state.isFullscreen ? 'خروج من Fullscreen' : 'Fullscreen';
    }
    setTimeout(scrollToBottom, 300);
  }

  // ============================================================
  // 🎨 بناء الواجهة
  // ============================================================
  function createChatUI() {
    const existing = document.getElementById('ai-agent-wrapper');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'ai-agent-wrapper';
    wrapper.innerHTML =
      '<button type="button" class="ai-fab" id="aiFab" title="مساعد رفاد الذكي (Ctrl+I)">' +
        '<span class="ai-fab-icon">🤖</span>' +
        '<span class="ai-fab-badge">AI</span>' +
      '</button>' +

      '<div class="ai-panel" id="aiPanel" role="dialog">' +

        '<div class="ai-header">' +
          '<div class="ai-header-info">' +
            '<div class="ai-header-icon">🤖</div>' +
            '<div class="ai-header-text">' +
              '<div class="ai-header-title">مساعد رفاد الذكي</div>' +
              '<div class="ai-header-sub" id="aiHeaderSub">جاهز للمساعدة</div>' +
            '</div>' +
          '</div>' +
          '<div class="ai-header-actions">' +
            '<button type="button" class="ai-header-btn" id="aiFullscreenBtn" title="Fullscreen">⛶</button>' +
            '<button type="button" class="ai-header-btn" id="aiClearBtn" title="مسح">🗑️</button>' +
            '<button type="button" class="ai-header-btn" id="aiCloseBtn" title="إغلاق">✕</button>' +
          '</div>' +
        '</div>' +

        '<div class="ai-personas" id="aiPersonasBar"></div>' +
        '<div class="ai-messages" id="aiMessages"></div>' +
        '<div class="ai-suggestions" id="aiSuggestions"></div>' +

        '<div class="ai-input-area">' +
          '<button type="button" class="ai-mic-btn" id="aiMicBtn" title="تسجيل صوتي">🎤</button>' +
          '<textarea id="aiInput" placeholder="اكتب سؤالك..." rows="1"></textarea>' +
          '<button type="button" class="ai-send-btn" id="aiSendBtn" title="إرسال">' +
            '<span class="ai-send-icon">➤</span>' +
          '</button>' +
        '</div>' +

        '<div class="ai-footer">' +
          '<span>مدعوم بـ <strong>Groq</strong> ⚡</span>' +
          '<span id="aiRoleBadge"></span>' +
        '</div>' +

      '</div>';

    const placeholder = document.getElementById('ai-agent-container');
    if (placeholder) {
      placeholder.appendChild(wrapper);
    } else {
      document.body.appendChild(wrapper);
    }

    state.container = wrapper;
    state.panelEl = wrapper.querySelector('#aiPanel');
    state.messagesEl = wrapper.querySelector('#aiMessages');
    state.inputEl = wrapper.querySelector('#aiInput');
    state.sendBtn = wrapper.querySelector('#aiSendBtn');
    state.micBtn = wrapper.querySelector('#aiMicBtn');
    state.personasBar = wrapper.querySelector('#aiPersonasBar');
    state.suggestionsEl = wrapper.querySelector('#aiSuggestions');
    state.headerSub = wrapper.querySelector('#aiHeaderSub');
    state.roleBadge = wrapper.querySelector('#aiRoleBadge');
    state.fullscreenBtn = wrapper.querySelector('#aiFullscreenBtn');

    const role = state.userRole;
    state.roleBadge.textContent = role === 'owner' ? '👑 مالك' : role === 'manager' ? '👔 مدير' : '👤 موظف';

    wrapper.querySelector('#aiFab').addEventListener('click', togglePanel);
    wrapper.querySelector('#aiCloseBtn').addEventListener('click', closePanel);
    wrapper.querySelector('#aiClearBtn').addEventListener('click', clearHistory);
    state.fullscreenBtn.addEventListener('click', toggleFullscreen);

    state.micBtn.addEventListener('click', function () {
      if (state.isRecording) stopRecording();
      else startRecording();
    });

    state.sendBtn.addEventListener('click', function () {
      sendMessage(state.inputEl.value);
    });

    state.inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(state.inputEl.value);
      }
    });

    state.inputEl.addEventListener('input', function () {
      state.inputEl.style.height = 'auto';
      state.inputEl.style.height = Math.min(state.inputEl.scrollHeight, 120) + 'px';
    });

    if (Config.SETTINGS.ui.fullscreenOnMobile && window.innerWidth <= 640) {
      state.isFullscreen = true;
    } else {
      state.isFullscreen = loadFullscreenPref();
    }
  }

  function updateSendBtn() {
    if (!state.sendBtn) return;
    if (state.isGenerating) {
      state.sendBtn.disabled = true;
      state.sendBtn.classList.add('loading');
      state.sendBtn.innerHTML = '<span class="ai-send-icon">⏳</span>';
    } else {
      state.sendBtn.disabled = false;
      state.sendBtn.classList.remove('loading');
      state.sendBtn.innerHTML = '<span class="ai-send-icon">➤</span>';
    }
  }

  function updateMicBtn() {
    if (!state.micBtn) return;
    if (state.isRecording) {
      state.micBtn.classList.add('recording');
      state.micBtn.textContent = '⏹️';
    } else {
      state.micBtn.classList.remove('recording');
      state.micBtn.textContent = '🎤';
    }
  }

  // ============================================================
  // 🚪 فتح/قفل
  // ============================================================
  function openPanel() {
    if (!canUseAI()) {
      toast('الميزة دي للمالك والمدير فقط', 'error');
      return;
    }

    state.isOpen = true;
    const fab = document.getElementById('aiFab');

    if (state.panelEl) state.panelEl.classList.add('open');
    if (fab) fab.classList.add('hidden');

    applyFullscreen();

    renderPersonasBar();
    renderSuggestions();
    renderMessages();
    bindMessageActions();
    updateHeaderSub();

    setTimeout(function () {
      if (state.inputEl) state.inputEl.focus();
      scrollToBottom();
    }, 100);
  }

  function closePanel() {
    state.isOpen = false;
    const fab = document.getElementById('aiFab');

    if (state.panelEl) state.panelEl.classList.remove('open');
    if (fab) fab.classList.remove('hidden');

    if (state.isRecording) stopRecording();
    if (state.currentAudio) {
      state.currentAudio.pause();
      state.currentAudio = null;
    }
  }

  function togglePanel() {
    if (state.isOpen) closePanel();
    else openPanel();
  }

  // ============================================================
  // 🎬 Init
  // ============================================================
  function init(session) {
    if (state.isReady) {
      console.log('[AIAgent] Already initialized');
      return;
    }

    state.session = session ||
      (window.Refad && Refad.Auth && Refad.Auth.getSession ? Refad.Auth.getSession() : null);

    if (!state.session) {
      console.warn('[AIAgent] ⚠️ No session');
      return;
    }

    state.companyId = state.session.company_id;
    state.userId = state.session.user_id;
    state.userName = state.session.full_name || 'مستخدم';
    state.userRole = getUserRole();

    if (!canUseAI()) {
      console.log('[AIAgent] ⚠️ User role: ' + state.userRole + ' — AI متوقف');
      return;
    }

    if (!initSupabase()) {
      console.error('[AIAgent] ⚠️ Supabase not available');
    }

    state.messages = loadHistory();

    const personas = getAvailablePersonas();
    if (personas.length > 0) {
      state.currentPersona = personas[0].id;
    }

    createChatUI();

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        togglePanel();
      }
      if (e.key === 'Escape' && state.isOpen) {
        if (state.isFullscreen) {
          toggleFullscreen();
        } else {
          closePanel();
        }
      }
      if (e.key === 'F11' && state.isOpen) {
        e.preventDefault();
        toggleFullscreen();
      }
    });

    state.isReady = true;

    console.log(
      '%c[AIAgent] ✅ v' + VERSION + ' Ready — Role: ' + state.userRole + ' — Fullscreen: ' + state.isFullscreen,
      'color:#14B8A6;font-weight:bold;font-size:13px'
    );
  }

  // ============================================================
  // 📤 Public API
  // ============================================================
  return {
    VERSION: VERSION,

    init: init,
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    send: sendMessage,
    setPersona: setPersona,
    clear: clearHistory,
    toggleFullscreen: toggleFullscreen,

    isOpen: function () { return state.isOpen; },
    isGenerating: function () { return state.isGenerating; },
    isReady: function () { return state.isReady; },
    isFullscreen: function () { return state.isFullscreen; },
    getRole: function () { return state.userRole; },
    getPersona: function () { return state.currentPersona; },
    getMessages: function () { return state.messages.slice(); },
    getState: function () { return state; },

    // Testing helpers
    executeSQL: executeSQL,
    executeTool: executeTool,

    // ✨ Rate Limit helpers
    getRateStatus: function () { return rateLimiter.getStatus(); },
    resetRateLimit: function () {
      rateLimiter.tokens.used = 0;
      rateLimiter.tokens.windowStart = Date.now();
      console.log('[AIAgent] ✅ Rate limit reset');
    }
  };
})();

console.log(
  '%c[AI Agent] ✅ v' + (window.AIAgent ? window.AIAgent.VERSION : '?') + ' Fully Loaded — Rate-Limit Optimized',
  'color:#14B8A6;font-weight:bold;font-size:13px'
);