/*
 * Gemini shakli ⇄ OpenAI shakli.
 *
 * Ilova ichkarida hamma narsani Gemini koʻrinishida yuritadi
 * (`contents` / `parts` / `functionCall`). OpenRouter esa OpenAI
 * «chat/completions» shaklini soʻraydi. Shu ikkisi orasidagi tarjima
 * shu faylda — boshqa hech qayerda provayder farqi bilinmaydi.
 *
 * Nega serverda: tarjimani mijozga qoldirsak, har bir platformada
 * (veb, Android, kengaytma) alohida tuzatish kerak boʻlardi va
 * OpenRouter kaliti brauzerga chiqib ketardi.
 */

/* ------------------------------------------------------------------ */
/*  Gemini → OpenAI                                                    */
/* ------------------------------------------------------------------ */

/** `{inlineData:{mimeType,data}}` → `data:` havolasi. */
function dataUrl(inline) {
  const mime = inline?.mimeType || 'image/png';
  return `data:${mime};base64,${inline?.data || ''}`;
}

/**
 * Bir `content` ni OpenAI xabarlariga aylantiradi.
 *
 * Bitta Gemini qatorida bir nechta `functionResponse` boʻlishi mumkin,
 * OpenAI da esa har javob alohida `tool` xabari — shuning uchun massiv
 * qaytariladi.
 */
function messagesFrom(content, toolNames) {
  const out = [];
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const role = content?.role === 'model' ? 'assistant' : 'user';

  const pieces = [];
  const calls = [];

  for (const part of parts) {
    if (part?.functionResponse) {
      const name = part.functionResponse.name;
      out.push({
        role: 'tool',
        tool_call_id: toolNames.get(name) || `call_${name}`,
        content: JSON.stringify(part.functionResponse.response ?? {}),
      });
      continue;
    }
    if (part?.functionCall) {
      const id = `call_${calls.length}_${part.functionCall.name}`;
      toolNames.set(part.functionCall.name, id);
      calls.push({
        id,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
      continue;
    }
    if (part?.inlineData) {
      const mime = String(part.inlineData.mimeType || '');
      // OpenAI shaklida faqat rasm bor; audio/video nomi bilan oʻtadi.
      if (mime.startsWith('image/')) {
        pieces.push({ type: 'image_url', image_url: { url: dataUrl(part.inlineData) } });
      } else {
        pieces.push({ type: 'text', text: `[fayl: ${mime}]` });
      }
      continue;
    }
    if (part?.fileData?.fileUri) {
      pieces.push({ type: 'text', text: `[havola: ${part.fileData.fileUri}]` });
      continue;
    }
    // «thought» qismlari faqat Gemini uchun — boshqasiga yuborilmaydi.
    if (part?.thought) continue;
    if (typeof part?.text === 'string' && part.text) {
      pieces.push({ type: 'text', text: part.text });
    }
  }

  if (calls.length) {
    const text = pieces.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
    out.push({ role: 'assistant', content: text || null, tool_calls: calls });
    return out;
  }

  if (!pieces.length) return out;

  // Faqat matn boʻlsa oddiy satr yuboramiz — koʻp model massivni yoqtirmaydi.
  const onlyText = pieces.every((p) => p.type === 'text');
  out.push({
    role,
    content: onlyText ? pieces.map((p) => p.text).join('\n') : pieces,
  });
  return out;
}

/** Gemini `parameters` sxemasidagi katta harfli turlarni kichiklashtiradi. */
function lowerSchema(node) {
  if (Array.isArray(node)) return node.map(lowerSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' && typeof value === 'string') out[key] = value.toLowerCase();
    else out[key] = lowerSchema(value);
  }
  return out;
}

/**
 * Gemini soʻrovini OpenAI soʻroviga aylantiradi.
 *
 * @param {object} body   Gemini generateContent tanasi
 * @param {string} model  Provayderdagi haqiqiy model nomi
 * @param {boolean} stream
 */
/*
 * Anthropic modellarida kesh nuqtasi.
 *
 * Agent sikli har qadamda AYNAN bir xil tizim koʻrsatmasini qayta
 * yuboradi. Anthropic buni keshlay oladi va keshdan oʻqilgan token
 * ~10 barobar arzon tushadi. Buning uchun xabarga `cache_control`
 * belgisi qoʻyiladi. Boshqa provayderlar bu maydonni tushunmasligi
 * mumkin, shuning uchun faqat anthropic modellariga qoʻshamiz.
 */
function keshlanadimi(model) {
  return /^anthropic\//i.test(String(model || ''));
}

/** Uzun matnnigina keshlash maʼnoli — qisqasi baribir arzon. */
const KESH_CHEGARASI = 2000;

export function toOpenAi(body, model, stream) {
  const toolNames = new Map();
  const messages = [];

  const system = (body?.systemInstruction?.parts ?? [])
    .map((p) => p?.text || '')
    .filter(Boolean)
    .join('\n');
  if (system) {
    const kesh = keshlanadimi(model) && system.length >= KESH_CHEGARASI;
    messages.push({
      role: 'system',
      content: kesh
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system,
    });
  }

  for (const content of body?.contents ?? []) {
    messages.push(...messagesFrom(content, toolNames));
  }

  const declarations = [];
  for (const tool of body?.tools ?? []) {
    for (const fn of tool?.functionDeclarations ?? []) {
      declarations.push({
        type: 'function',
        function: {
          name: fn.name,
          description: fn.description || '',
          parameters: lowerSchema(fn.parameters ?? { type: 'object', properties: {} }),
        },
      });
    }
  }

  const cfg = body?.generationConfig ?? {};
  const request = {
    model,
    messages,
    stream,
  };
  if (stream) request.stream_options = { include_usage: true };
  if (declarations.length) {
    request.tools = declarations;
    request.tool_choice = 'auto';
  }
  if (typeof cfg.temperature === 'number') request.temperature = cfg.temperature;
  if (typeof cfg.topP === 'number') request.top_p = cfg.topP;
  if (typeof cfg.maxOutputTokens === 'number') request.max_tokens = cfg.maxOutputTokens;
  if (cfg.responseMimeType === 'application/json') {
    request.response_format = { type: 'json_object' };
  }
  if (Array.isArray(cfg.stopSequences) && cfg.stopSequences.length) {
    request.stop = cfg.stopSequences.slice(0, 4);
  }

  return request;
}

/* ------------------------------------------------------------------ */
/*  OpenAI → Gemini                                                    */
/* ------------------------------------------------------------------ */

const FINISH = {
  stop: 'STOP',
  length: 'MAX_TOKENS',
  tool_calls: 'STOP',
  content_filter: 'SAFETY',
};

function parseArgs(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { _xom: String(text) };
  }
}

/** OpenAI `usage` → Gemini `usageMetadata`. */
export function usageFrom(usage) {
  if (!usage) return null;
  const input = Number(usage.prompt_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? 0);
  return {
    promptTokenCount: input,
    candidatesTokenCount: output,
    totalTokenCount: Number(usage.total_tokens ?? input + output),
  };
}

/** Oqimsiz javobni Gemini shakliga keltiradi. */
export function fromOpenAi(data) {
  const choice = data?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const parts = [];

  if (typeof message.content === 'string' && message.content) {
    parts.push({ text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const piece of message.content) {
      if (piece?.type === 'text' && piece.text) parts.push({ text: piece.text });
    }
  }

  /*
   * Rasm chiqaradigan modellar.
   *
   * OpenRouter rasmni `message.images[].image_url.url` da data-URL
   * koʻrinishida qaytaradi. Ilgari bu qism umuman oʻqilmasdi va
   * rasm modeli boʻsh javob bergandek koʻrinardi.
   */
  for (const img of message.images ?? []) {
    const url = img?.image_url?.url ?? img?.url ?? '';
    const m = /^data:([^;]+);base64,(.+)$/.exec(String(url));
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }

  // Baʼzi modellar «fikrlash» matnini alohida maydonda qaytaradi.
  if (typeof message.reasoning === 'string' && message.reasoning && !parts.length) {
    parts.push({ text: message.reasoning });
  }

  for (const call of message.tool_calls ?? []) {
    parts.push({
      functionCall: {
        name: call?.function?.name || '',
        args: parseArgs(call?.function?.arguments),
      },
    });
  }

  // Rasm qaytaradigan modellar (OpenRouter `images`) — inlineData ga.
  for (const image of message.images ?? []) {
    const url = image?.image_url?.url || '';
    const match = /^data:([^;]+);base64,(.*)$/.exec(url);
    if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
  }

  return {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: FINISH[choice.finish_reason] ?? 'STOP',
        index: 0,
      },
    ],
    ...(usageFrom(data?.usage) ? { usageMetadata: usageFrom(data.usage) } : {}),
  };
}

/**
 * Oqim tarjimoni.
 *
 * OpenAI tool chaqiruvi boʻlaklab keladi (`arguments` satri qismlarga
 * boʻlinadi), Gemini esa butun `functionCall` ni kutadi. Shuning uchun
 * chaqiruvlar yigʻilib, oqim tugaganda bitta boʻlak boʻlib chiqadi.
 */
export function streamTranslator() {
  const calls = new Map();
  let usage = null;
  let finish = 'STOP';

  return {
    /** Bitta SSE `data:` boʻlagi → Gemini boʻlagi (yoki `null`). */
    chunk(payload) {
      if (payload?.usage) usage = payload.usage;
      const choice = payload?.choices?.[0];
      if (!choice) return null;
      if (choice.finish_reason) finish = FINISH[choice.finish_reason] ?? 'STOP';

      const delta = choice.delta ?? {};
      for (const call of delta.tool_calls ?? []) {
        const index = Number(call.index ?? 0);
        const found = calls.get(index) ?? { name: '', args: '' };
        if (call?.function?.name) found.name = call.function.name;
        if (call?.function?.arguments) found.args += call.function.arguments;
        calls.set(index, found);
      }

      const text =
        typeof delta.content === 'string'
          ? delta.content
          : Array.isArray(delta.content)
            ? delta.content.map((p) => p?.text || '').join('')
            : '';
      if (!text) return null;

      return {
        candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }],
      };
    },

    /** Oqim tugadi: tool chaqiruvlari va token hisobi. */
    flush() {
      const parts = [];
      for (const call of calls.values()) {
        if (!call.name) continue;
        parts.push({ functionCall: { name: call.name, args: parseArgs(call.args) } });
      }
      const meta = usageFrom(usage);
      if (!parts.length && !meta) return null;
      return {
        candidates: [
          { content: { role: 'model', parts }, finishReason: finish, index: 0 },
        ],
        ...(meta ? { usageMetadata: meta } : {}),
      };
    },

    usage() {
      return usageFrom(usage);
    },
  };
}
