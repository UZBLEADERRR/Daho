/*
 * Ulanishlar — Daho ni boshqa ilovalar bilan bogʻlash.
 *
 * Ilova serverisiz ishlagani uchun ulanish oddiy: foydalanuvchi manzil va
 * kalitni bir marta kiritadi, keyin agent shu xizmatga soʻrov yubora oladi.
 * Telegram, Discord, Slack, Notion, Airtable, n8n/Make, Home Assistant —
 * hammasi HTTP orqali ishlaydi, shuning uchun bitta mexanizm yetarli.
 *
 * Kalitlar faqat qurilmada qoladi: bulutga sinxronlanmaydi.
 */

import { getState, setState } from './store';
import type { Connector, ConnectorAction } from './types';
import { uid } from './utils';

/* ------------------------------------------------------------------ */
/*  Tayyor namunalar                                                   */
/* ------------------------------------------------------------------ */

export interface ConnectorPreset {
  id: string;
  name: string;
  icon: string;
  hint: string;
  /** Foydalanuvchi nima kiritishi kerak */
  needs: string;
  build: (secret: string, extra: string) => Omit<Connector, 'id' | 'enabled'>;
}

const json = (obj: unknown) => JSON.stringify(obj, null, 2);

export const CONNECTOR_PRESETS: ConnectorPreset[] = [
  {
    id: 'telegram',
    name: 'Telegram bot',
    icon: '✈️',
    hint: 'Oʻzingizga yoki kanalga xabar, rasm va fayl yuboradi.',
    needs: 'Bot tokeni (@BotFather bergan) va chat ID',
    build: (token, chatId) => ({
      name: 'Telegram',
      icon: '✈️',
      baseUrl: `https://api.telegram.org/bot${token}`,
      auth: { kind: 'yoq' },
      note: `Standart chat ID: ${chatId}`,
      actions: [
        {
          id: 'send',
          name: 'xabar yuborish',
          description: 'Telegramga matn yuboradi. Maydonlar: text (majburiy), chat_id.',
          method: 'POST',
          path: '/sendMessage',
          bodyTemplate: json({ chat_id: chatId || '{{chat_id}}', text: '{{text}}' }),
        },
        {
          id: 'photo',
          name: 'rasm yuborish',
          description: 'Havoladagi rasmni yuboradi. Maydonlar: photo (URL), caption.',
          method: 'POST',
          path: '/sendPhoto',
          bodyTemplate: json({ chat_id: chatId || '{{chat_id}}', photo: '{{photo}}', caption: '{{caption}}' }),
        },
      ],
    }),
  },
  {
    id: 'webhook',
    name: 'Webhook (n8n, Make, Zapier)',
    icon: '🪝',
    hint: 'Istalgan avtomatlashtirish xizmatiga maʼlumot uzatadi.',
    needs: 'Webhook manzili',
    build: (url) => ({
      name: 'Webhook',
      icon: '🪝',
      baseUrl: url,
      auth: { kind: 'yoq' },
      actions: [
        {
          id: 'send',
          name: 'maʼlumot yuborish',
          description: 'Ixtiyoriy JSON yuboradi — qabul qiluvchi xizmat oʻzi ishlov beradi.',
          method: 'POST',
          path: '',
          bodyTemplate: json({ matn: '{{text}}', manba: 'Daho' }),
        },
      ],
    }),
  },
  {
    id: 'discord',
    name: 'Discord webhook',
    icon: '🎮',
    hint: 'Discord kanaliga xabar tashlaydi.',
    needs: 'Webhook manzili',
    build: (url) => ({
      name: 'Discord',
      icon: '🎮',
      baseUrl: url,
      auth: { kind: 'yoq' },
      actions: [
        {
          id: 'send',
          name: 'xabar yuborish',
          description: 'Kanalga matn yozadi. Maydon: content.',
          method: 'POST',
          path: '',
          bodyTemplate: json({ content: '{{content}}' }),
        },
      ],
    }),
  },
  {
    id: 'slack',
    name: 'Slack webhook',
    icon: '💬',
    hint: 'Slack kanaliga xabar yuboradi.',
    needs: 'Incoming webhook manzili',
    build: (url) => ({
      name: 'Slack',
      icon: '💬',
      baseUrl: url,
      auth: { kind: 'yoq' },
      actions: [
        {
          id: 'send',
          name: 'xabar yuborish',
          description: 'Kanalga matn yozadi. Maydon: text.',
          method: 'POST',
          path: '',
          bodyTemplate: json({ text: '{{text}}' }),
        },
      ],
    }),
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: '📓',
    hint: 'Notion bazasiga yangi sahifa qoʻshadi.',
    needs: 'Integration tokeni va baza ID',
    build: (token, dbId) => ({
      name: 'Notion',
      icon: '📓',
      baseUrl: 'https://api.notion.com/v1',
      auth: { kind: 'bearer', value: token },
      headers: { 'Notion-Version': '2022-06-28' },
      note: `Baza: ${dbId}`,
      actions: [
        {
          id: 'create',
          name: 'sahifa qoʻshish',
          description: 'Bazaga yangi yozuv qoʻshadi. Maydon: title.',
          method: 'POST',
          path: '/pages',
          bodyTemplate: json({
            parent: { database_id: dbId || '{{database_id}}' },
            properties: { Name: { title: [{ text: { content: '{{title}}' } }] } },
          }),
        },
        {
          id: 'query',
          name: 'yozuvlarni olish',
          description: 'Bazadagi yozuvlarni oʻqiydi.',
          method: 'POST',
          path: `/databases/${dbId || '{{database_id}}'}/query`,
          bodyTemplate: json({ page_size: 20 }),
        },
      ],
    }),
  },
  {
    id: 'airtable',
    name: 'Airtable',
    icon: '📊',
    hint: 'Jadvalga qator qoʻshadi va oʻqiydi.',
    needs: 'API kalit va baza ID',
    build: (token, baseId) => ({
      name: 'Airtable',
      icon: '📊',
      baseUrl: `https://api.airtable.com/v0/${baseId}`,
      auth: { kind: 'bearer', value: token },
      actions: [
        {
          id: 'create',
          name: 'qator qoʻshish',
          description: 'Jadvalga qator qoʻshadi. Maydonlar: table, fields (obyekt).',
          method: 'POST',
          path: '/{{table}}',
          bodyTemplate: json({ fields: '{{fields}}' }),
        },
        {
          id: 'list',
          name: 'qatorlarni oʻqish',
          description: 'Jadvaldagi qatorlarni qaytaradi. Maydon: table.',
          method: 'GET',
          path: '/{{table}}?maxRecords=20',
        },
      ],
    }),
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    icon: '🏠',
    hint: 'Uydagi qurilmalarni yoqadi va oʻchiradi.',
    needs: 'Server manzili va uzoq muddatli token',
    build: (token, url) => ({
      name: 'Home Assistant',
      icon: '🏠',
      baseUrl: `${(url || '').replace(/\/$/, '')}/api`,
      auth: { kind: 'bearer', value: token },
      actions: [
        {
          id: 'service',
          name: 'qurilmani boshqarish',
          description:
            'Xizmatni chaqiradi. Maydonlar: domain (light, switch…), service (turn_on…), entity_id.',
          method: 'POST',
          path: '/services/{{domain}}/{{service}}',
          bodyTemplate: json({ entity_id: '{{entity_id}}' }),
        },
        {
          id: 'states',
          name: 'holatni oʻqish',
          description: 'Qurilma holatini qaytaradi. Maydon: entity_id.',
          method: 'GET',
          path: '/states/{{entity_id}}',
        },
      ],
    }),
  },
  {
    id: 'custom',
    name: 'Boshqa xizmat (qoʻlda)',
    icon: '🔌',
    hint: 'Istalgan API — manzil, kalit va amallarni oʻzingiz yozasiz.',
    needs: 'Asosiy manzil',
    build: (url) => ({
      name: 'Yangi ulanish',
      icon: '🔌',
      baseUrl: url,
      auth: { kind: 'yoq' },
      actions: [
        {
          id: 'call',
          name: 'soʻrov yuborish',
          description: 'Xizmatga soʻrov yuboradi.',
          method: 'GET',
          path: '',
        },
      ],
    }),
  },
];

/* ------------------------------------------------------------------ */
/*  Saqlash                                                            */
/* ------------------------------------------------------------------ */

export function listConnectors(): Connector[] {
  return getState().settings.connectors ?? [];
}

export function activeConnectors(): Connector[] {
  return listConnectors().filter((c) => c.enabled && c.baseUrl);
}

export function saveConnector(connector: Connector): void {
  setState((s) => {
    const list = s.settings.connectors ?? [];
    const exists = list.some((c) => c.id === connector.id);
    return {
      settings: {
        ...s.settings,
        connectors: exists
          ? list.map((c) => (c.id === connector.id ? connector : c))
          : [...list, connector],
      },
    };
  });
}

export function deleteConnector(id: string): void {
  setState((s) => ({
    settings: { ...s.settings, connectors: (s.settings.connectors ?? []).filter((c) => c.id !== id) },
  }));
}

export function connectorFromPreset(
  preset: ConnectorPreset,
  secret: string,
  extra = '',
): Connector {
  return { ...preset.build(secret, extra), id: uid('conn_'), enabled: true };
}

/* ------------------------------------------------------------------ */
/*  Chaqirish                                                          */
/* ------------------------------------------------------------------ */

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const QUOTED_PLACEHOLDER = /"\{\{\s*([\w.]+)\s*\}\}"/g;

/** Manzil uchun: qiymatni matnga aylantirib, yoʻlga xavfsiz qoʻyadi. */
function fillPath(template: string, data: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    // Manzilning oʻzini buzmaslik uchun — boʻsh joy, kirill va boshqalar kodlanadi.
    return encodeURIComponent(text);
  });
}

/**
 * JSON tanasini toʻldiradi.
 *
 * Muhim nuqta: `"{{fields}}"` kabi butunlay qoʻshtirnoq ichidagi oʻrin egasi
 * qiymat turini saqlashi kerak — obyekt obyekt, massiv massiv, son son boʻlib
 * qolsin. Aks holda Airtable/Notion kabi xizmatlar matnni qabul qilmaydi.
 * Matn ichida turgan oʻrin egasi esa (`"Salom {{ism}}"`) JSON uchun
 * qochiriladi, chunki qiymatda qoʻshtirnoq boʻlsa fayl buzilardi.
 */
function buildBody(template: string, data: Record<string, unknown>): string {
  return template
    .replace(QUOTED_PLACEHOLDER, (_, key: string) => {
      const value = data[key];
      return value === undefined || value === null ? '""' : JSON.stringify(value);
    })
    .replace(PLACEHOLDER, (_, key: string) => {
      const value = data[key];
      const text =
        typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
      // Qoʻshtirnoqsiz joylashtiramiz, lekin belgilarni qochiramiz.
      return JSON.stringify(text).slice(1, -1);
    });
}

export interface ConnectorResult {
  ok: boolean;
  status: number;
  body: string;
}

export function findConnector(nameOrId: string): Connector | undefined {
  const needle = nameOrId.trim().toLowerCase();
  const list = activeConnectors();
  return (
    list.find((c) => c.id === nameOrId) ??
    list.find((c) => c.name.toLowerCase() === needle) ??
    list.find((c) => c.name.toLowerCase().includes(needle))
  );
}

export function findAction(connector: Connector, nameOrId: string): ConnectorAction | undefined {
  const needle = nameOrId.trim().toLowerCase();
  return (
    connector.actions.find((a) => a.id === nameOrId) ??
    connector.actions.find((a) => a.name.toLowerCase() === needle) ??
    connector.actions.find((a) => a.name.toLowerCase().includes(needle)) ??
    (connector.actions.length === 1 ? connector.actions[0] : undefined)
  );
}

/** Ulanishga soʻrov yuboradi va javobni qaytaradi. */
export async function callConnector(
  connector: Connector,
  action: ConnectorAction,
  data: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<ConnectorResult> {
  const path = fillPath(action.path, data);
  const url = `${connector.baseUrl.replace(/\/$/, '')}${path.startsWith('/') || !path ? path : `/${path}`}`;

  const headers: Record<string, string> = { ...(connector.headers ?? {}) };
  const auth = connector.auth ?? { kind: 'yoq' };
  if (auth.kind === 'bearer' && auth.value) headers.Authorization = `Bearer ${auth.value}`;
  if (auth.kind === 'header' && auth.name && auth.value) headers[auth.name] = auth.value;

  let target = url;
  if (auth.kind === 'query' && auth.name && auth.value) {
    target += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(auth.name)}=${encodeURIComponent(auth.value)}`;
  }

  const hasBody = action.method !== 'GET' && action.method !== 'DELETE';
  const body = hasBody && action.bodyTemplate ? buildBody(action.bodyTemplate, data) : undefined;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(target, { method: action.method, headers, body, signal });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body: text.slice(0, 4000) };
}

/** Modelga koʻrsatiladigan roʻyxat — qanday ulanish va qanday amal bor. */
export function connectorCatalog(): string {
  const list = activeConnectors();
  if (!list.length) return '';
  return list
    .map(
      (c) =>
        `- ${c.icon} ${c.name}: ${c.actions.map((a) => `«${a.name}» (${a.description})`).join('; ')}`,
    )
    .join('\n');
}
