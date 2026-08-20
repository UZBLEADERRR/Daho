import { DEFAULT_MODEL, callGemini, sourcesOf, textOf, usageOf } from './gemini.js';

/**
 * Bitta vazifani bajaradi.
 *
 * Edge funksiyadan farqi: bu yerda vaqt chegarasi yoʻq, shuning uchun
 * koʻp qadamli ishlar (kitob boblari) ham oxirigacha yetadi.
 */
export async function runJob(job, onNote) {
  const model = job.model || DEFAULT_MODEL[job.kind] || DEFAULT_MODEL.chat;
  const payload = job.payload ?? {};

  if (job.kind === 'kitob') return runBook(job, model, onNote);

  const prompt = String(payload.prompt ?? payload.question ?? payload.goal ?? job.title ?? '');
  if (!prompt) throw new Error('Vazifa matni boʻsh.');

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: Number(payload.temperature ?? 0.7) },
  };
  if (payload.system) body.systemInstruction = { parts: [{ text: String(payload.system) }] };

  if (job.kind === 'search') {
    body.tools = [{ google_search: {} }];
    delete body.generationConfig;
  }
  if (job.kind === 'json' || job.kind === 'plan') {
    body.generationConfig = {
      temperature: 0.6,
      responseMimeType: 'application/json',
      ...(payload.schema ? { responseSchema: payload.schema } : {}),
    };
  }
  if (job.kind === 'image') body.generationConfig = { responseModalities: ['IMAGE', 'TEXT'] };

  const data = await callGemini(model, body);
  const usage = usageOf(data);

  if (job.kind === 'image') {
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const image = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!image) throw new Error('Model rasm qaytarmadi.');
    return { result: { kind: 'image', mimeType: image.mimeType, data: image.data }, ...usage, model };
  }

  if (job.kind === 'json' || job.kind === 'plan') {
    const text = textOf(data);
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = fenced ? JSON.parse(fenced[1]) : { text };
    }
    return { result: { kind: job.kind, data: parsed }, ...usage, model };
  }

  return {
    result: { kind: 'text', text: textOf(data), sources: sourcesOf(data) },
    ...usage,
    model,
  };
}

/**
 * Kitob — serverning asosiy sababi.
 *
 * Har bob alohida soʻrovda yoziladi. Telefonda bu ilova ochiq turishini
 * talab qilardi; bu yerda esa foydalanuvchi telefonini oʻchirib qoʻysa ham
 * oxirigacha yozilib boradi.
 */
async function runBook(job, model, onNote) {
  const payload = job.payload ?? {};
  const topic = String(payload.topic ?? job.title ?? '').trim();
  if (!topic) throw new Error('Kitob mavzusi boʻsh.');

  const chapterCount = Math.max(3, Math.min(24, Number(payload.chapters ?? 8)));
  const language = String(payload.language ?? 'oʻzbek');
  let input = 0;
  let output = 0;

  // 1) Reja
  const planData = await callGemini(model, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `«${topic}» mavzusida ${language} tilida kitob rejasini tuz. ` +
              `${chapterCount} ta bob. Har bob uchun sarlavha va 1-2 jumlalik mazmun.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          chapters: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { title: { type: 'STRING' }, summary: { type: 'STRING' } },
              required: ['title'],
            },
          },
        },
        required: ['title', 'chapters'],
      },
    },
  });
  const planUsage = usageOf(planData);
  input += planUsage.input;
  output += planUsage.output;

  let plan;
  try {
    plan = JSON.parse(textOf(planData));
  } catch {
    throw new Error('Reja tushunarsiz qaytdi.');
  }
  const chapters = (plan.chapters ?? []).slice(0, chapterCount);
  if (!chapters.length) throw new Error('Reja boʻsh.');

  onNote?.(`reja tayyor — ${chapters.length} bob`);

  // 2) Boblarni bittalab yozamiz
  const written = [];
  for (let i = 0; i < chapters.length; i += 1) {
    const ch = chapters[i];
    const previous = written
      .slice(-2)
      .map((c) => `${c.title}: ${c.text.slice(0, 300)}`)
      .join('\n');

    const data = await callGemini(model, {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Kitob: «${plan.title}». ${language} tilida yoz.\n` +
                `Bu ${i + 1}-bob: «${ch.title}».\n` +
                (ch.summary ? `Bob mazmuni: ${ch.summary}\n` : '') +
                (previous ? `\nOldingi boblardan parcha:\n${previous}\n` : '') +
                `\nBobni TOʻLIQ yoz: 700-1200 soʻz, markdown sarlavhalar bilan. ` +
                `Boshqa bobga oʻtma, faqat shu bobni yakunla.`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.8 },
    });

    const u = usageOf(data);
    input += u.input;
    output += u.output;
    written.push({ title: ch.title, text: textOf(data) });
    onNote?.(`${i + 1}/${chapters.length} bob yozildi`);
  }

  return {
    result: {
      kind: 'kitob',
      title: plan.title,
      chapters: written,
      words: written.reduce((n, c) => n + c.text.split(/\s+/).length, 0),
    },
    input,
    output,
    model,
  };
}
