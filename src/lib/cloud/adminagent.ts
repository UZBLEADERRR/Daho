/**
 * Admin agenti — panelni gap bilan boshqarish.
 *
 * Model qoʻshish qoʻlda juda koʻp qadam edi: katalogdan topish, slug
 * oʻylash, narx yozish, tarifga ulash. Endi buyruq beriladi:
 * «eng arzon uchta vosita ishlatadigan model qoʻsh, hammasini Pro ga
 * ul» — qolganini agent qiladi.
 *
 * ISHONCH QOIDASI: agent hech narsani soʻramasdan bajarmaydi. U avval
 * REJA tuzadi, reja ekranda koʻrinadi, admin «Bajarish» bosgandagina
 * amallar ishga tushadi. Sabab oddiy: model xato tushunsa, u tarifni
 * yoki narxni jimgina buzib qoʻymasin.
 */
import { jsonAny } from '../providers';
import {
  adminPlans,
  decideRequest,
  pendingRequests,
  setAppSetting,
} from './admin';
import {
  aiModels,
  attachModel,
  creditRate,
  deleteAiModel,
  openrouterCatalog,
  saveAiModel,
  saveCreditRate,
  type AiModel,
  type CatalogModel,
} from './catalog';

/* ------------------------------------------------------------------ */
/*  Amallar lugʻati                                                    */
/* ------------------------------------------------------------------ */

/**
 * Agent FAQAT shu amallarni chiqara oladi. Yopiq roʻyxat: model
 * oʻzicha yangi buyruq oʻylab topolmaydi va kutilmagan joyga
 * tegolmaydi.
 */
export type Amal =
  | {
      tur: 'model_qosh';
      upstream: string;
      slug: string;
      label: string;
      description?: string;
      role?: string;
    }
  | { tur: 'model_ochir'; slug: string }
  | { tur: 'model_holat'; slug: string; enabled: boolean }
  | { tur: 'tarifga_ul'; slug: string; tariflar: string[] }
  | { tur: 'kredit_kursi'; usd_per_credit?: number; markup?: number }
  | { tur: 'kunlik_model'; slug: string }
  | { tur: 'ariza_hal'; id: string; qabul: boolean; kun?: number };

export interface Reja {
  javob: string;
  amallar: Amal[];
}

const SXEMA = {
  type: 'object',
  properties: {
    javob: { type: 'string' },
    amallar: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tur: { type: 'string' },
          upstream: { type: 'string' },
          slug: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          role: { type: 'string' },
          tariflar: { type: 'array', items: { type: 'string' } },
          usd_per_credit: { type: 'number' },
          markup: { type: 'number' },
          id: { type: 'string' },
          qabul: { type: 'boolean' },
          kun: { type: 'number' },
          enabled: { type: 'boolean' },
        },
        required: ['tur'],
      },
    },
  },
  required: ['javob'],
};

/* ------------------------------------------------------------------ */
/*  Kontekst                                                           */
/* ------------------------------------------------------------------ */

export interface Holat {
  models: AiModel[];
  plans: Array<{ id: string; code: string; name: string }>;
  rate: { usd_per_credit: number; markup: number };
  requests: Array<{ id: string; user: string; plan: string; contact: string }>;
  catalog: CatalogModel[];
}

/**
 * Panelning hozirgi holati.
 *
 * OpenRouter roʻyxati 300+ model — hammasini modelga berish token
 * isrofi. Shuning uchun faqat vosita ishlatadigan, konteksti yetarli
 * va ARZONlaridan 40 tasi olinadi: «arzon model qoʻsh» degan buyruq
 * uchun shu yetadi.
 */
export async function holatniOl(): Promise<Holat> {
  const [models, plans, rate, requests, catalog] = await Promise.all([
    aiModels().catch(() => [] as AiModel[]),
    adminPlans().catch(() => []),
    creditRate().catch(() => ({ usd_per_credit: 0.00005, markup: 2 })),
    pendingRequests().catch(() => []),
    openrouterCatalog().catch(() => [] as CatalogModel[]),
  ]);

  const tanlangan = catalog
    .filter((m) => m.supports_tools && m.context >= 32_000)
    .sort((a, b) => a.input_usd + a.output_usd - (b.input_usd + b.output_usd))
    .slice(0, 40);

  return {
    models,
    plans: plans.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    rate,
    requests: requests.map((r) => ({
      id: r.id,
      user: r.user_id,
      plan: r.plan_id,
      contact: r.contact ?? '',
    })),
    catalog: tanlangan,
  };
}

/* ------------------------------------------------------------------ */
/*  Reja tuzish                                                        */
/* ------------------------------------------------------------------ */

export async function rejaTuz(buyruq: string, holat: Holat): Promise<Reja> {
  const prompt = `Sen Daho platformasining admin yordamchisisan. Egasi buyruq beradi,
sen QILINADIGAN AMALLAR ro'yxatini tuzasan. Amallarni o'zing bajarmaysan —
ular ekranda ko'rsatiladi va egasi tasdiqlaydi.

## Buyruq
«${buyruq}»

## Hozirgi holat
Daho modellari (${holat.models.length} ta):
${holat.models.map((m) => `- ${m.slug} · "${m.label}" · ${m.provider}/${m.upstream} · $${m.cost_input_usd}/$${m.cost_output_usd} · ${m.enabled ? 'yoqilgan' : 'o‘chiq'}`).join('\n') || '- (bo‘sh)'}

Tariflar: ${holat.plans.map((p) => `${p.code}="${p.name}"`).join(', ') || '(yo‘q)'}
Kredit kursi: 1 kredit = $${holat.rate.usd_per_credit}, ustama ×${holat.rate.markup}

Kutayotgan arizalar (${holat.requests.length} ta):
${holat.requests.map((r) => `- id=${r.id} · ${r.user} · ${r.plan} · aloqa: ${r.contact}`).join('\n') || '- (yo‘q)'}

OpenRouter'dagi mos modellar (vosita ishlatadi, arzondan qimmatga):
${holat.catalog.map((m) => `- ${m.id} · "${m.name}" · kirish $${m.input_usd}/1M · chiqish $${m.output_usd}/1M · ${Math.round(m.context / 1000)}k`).join('\n') || '- (ro‘yxat bo‘sh)'}

## Amallar
- model_qosh {upstream, slug, label, description?, role?} — katalogga model qo'shadi.
  \`upstream\` — YUQORIDAGI ro'yxatdan aynan olingan id. O'zingdan to'qima.
  \`slug\` — lotin harflar va chiziqcha, masalan "daho-tez".
  \`label\` — foydalanuvchi ko'radigan nom, masalan "Daho Tez".
- model_ochir {slug}
- model_holat {slug, enabled}
- tarifga_ul {slug, tariflar} — tariflar: ${holat.plans.map((p) => p.code).join('|') || 'free|start|pro'}
- kredit_kursi {usd_per_credit?, markup?}
- kunlik_model {slug} — bepul zaxira model.
- ariza_hal {id, qabul, kun?} — arizani tasdiqlash yoki rad etish.

## Qoidalar
- Faqat yuqoridagi amallarni ishlat. Boshqasini o'ylab topma.
- \`upstream\` faqat ro'yxatdan olinadi; ro'yxatda yo'q bo'lsa amal qo'shma va
  buni \`javob\` da ayt.
- Narx yozma: u tannarxdan avtomatik hisoblanadi.
- Buyruq tushunarsiz bo'lsa \`amallar\` ni bo'sh qoldir va \`javob\` da
  aniq savol ber.
- \`javob\` — o'zbek tilida, qisqa: nima qilmoqchisan va nega.`;

  const res = await jsonAny<Reja>(prompt, SXEMA);
  return { javob: String(res?.javob ?? ''), amallar: (res?.amallar ?? []).slice(0, 20) };
}

/* ------------------------------------------------------------------ */
/*  Bajarish                                                           */
/* ------------------------------------------------------------------ */

/** Bitta amalni odam oʻqiydigan qatorga aylantiradi. */
export function amalMatni(a: Amal, holat: Holat): string {
  switch (a.tur) {
    case 'model_qosh': {
      const m = holat.catalog.find((c) => c.id === a.upstream);
      const narx = m ? ` · $${m.input_usd}/$${m.output_usd} per 1M` : '';
      return `Model qo'shish: «${a.label}» ← ${a.upstream}${narx}`;
    }
    case 'model_ochir':
      return `Modelni o'chirish: ${a.slug}`;
    case 'model_holat':
      return `${a.slug} — ${a.enabled ? 'yoqish' : 'o‘chirish'}`;
    case 'tarifga_ul':
      return `Tariflarga ulash: ${a.slug} → ${a.tariflar.join(', ')}`;
    case 'kredit_kursi':
      return `Kredit kursi: ${a.usd_per_credit ? `1 kredit = $${a.usd_per_credit}` : ''}${
        a.markup ? ` ustama ×${a.markup}` : ''
      }`;
    case 'kunlik_model':
      return `Kunlik bepul model: ${a.slug}`;
    case 'ariza_hal': {
      const r = holat.requests.find((x) => x.id === a.id);
      return `Ariza ${a.qabul ? 'tasdiqlanadi' : 'rad etiladi'}: ${r?.user ?? a.id}`;
    }
    default:
      return 'Nomaʼlum amal';
  }
}

export interface Natija {
  matn: string;
  ok: boolean;
  xato?: string;
}

/**
 * Amallarni ketma-ket bajaradi.
 *
 * Ketma-ket — ataylab: `tarifga_ul` undan oldingi `model_qosh` ga
 * tayanadi. Bittasi yiqilsa qolganlari davom etadi va natijada
 * nimaisi boʻlgani roʻyxat boʻlib qaytadi.
 */
export async function amallarniBajar(amallar: Amal[], holat: Holat): Promise<Natija[]> {
  const natijalar: Natija[] = [];

  for (const a of amallar) {
    const matn = amalMatni(a, holat);
    try {
      switch (a.tur) {
        case 'model_qosh': {
          const m = holat.catalog.find((c) => c.id === a.upstream);
          if (!m) throw new Error(`«${a.upstream}» katalogda topilmadi`);
          await saveAiModel({
            slug: a.slug,
            label: a.label,
            description: a.description ?? m.description.slice(0, 120),
            provider: 'openrouter',
            upstream: m.id,
            cost_input_usd: Number(m.input_usd.toFixed(6)),
            cost_output_usd: Number(m.output_usd.toFixed(6)),
            supports_tools: m.supports_tools,
            supports_vision: m.supports_vision,
            supports_stream: true,
            context_tokens: m.context,
            role: a.role ?? 'chat',
            enabled: true,
          });
          break;
        }
        case 'model_ochir':
          await deleteAiModel(a.slug);
          break;
        case 'model_holat':
          await saveAiModel({ slug: a.slug, enabled: a.enabled });
          break;
        case 'tarifga_ul': {
          const ids = holat.plans
            .filter((p) => a.tariflar.includes(p.code))
            .map((p) => p.id);
          if (!ids.length) throw new Error('tarif topilmadi');
          await attachModel(a.slug, ids);
          break;
        }
        case 'kredit_kursi':
          await saveCreditRate({
            usd_per_credit: a.usd_per_credit ?? holat.rate.usd_per_credit,
            markup: a.markup ?? holat.rate.markup,
          });
          break;
        case 'kunlik_model':
          await setAppSetting('daily_model', { model: a.slug, label: 'Daho Daily' });
          break;
        case 'ariza_hal':
          await decideRequest(a.id, a.qabul, a.kun ?? 30);
          break;
        default:
          throw new Error('nomaʼlum amal');
      }
      natijalar.push({ matn, ok: true });
    } catch (err) {
      natijalar.push({ matn, ok: false, xato: String((err as Error)?.message ?? err) });
    }
  }

  return natijalar;
}
