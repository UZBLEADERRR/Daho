/**
 * Popup — tez amallar.
 *
 * Bu yerda uzun suhbat qilinmaydi: bosilgan amal yon panelda ochiladi,
 * chunki popup boshqa joyga bosilishi bilan yopilib qoladi.
 */

import { quota, type Quota } from './lib/api';
import { session, signIn } from './lib/auth';
import { server } from './lib/config';
import { currentPage } from './lib/page';
import { $, el, tokenLabel } from './lib/ui';

const QUICK: Array<{ id: string; icon: string; label: string; key: string }> = [
  { id: 'qisqacha', icon: '≡', label: 'Sahifani qisqacha aytib ber', key: 'S' },
  { id: 'tarjima', icon: '文', label: 'Tanlangan matnni tarjima qil', key: 'T' },
  { id: 'tushuntir', icon: '?', label: 'Tanlanganini tushuntir', key: 'K' },
  { id: 'savol', icon: '✎', label: 'Sahifa boʻyicha savol', key: 'N' },
];

function header(): HTMLElement {
  const head = el('div', 'head');
  head.appendChild(el('div', 'mark', 'D'));
  const brand = el('div', 'brand grow');
  brand.append(document.createTextNode('Daho'), el('span', '', '.'));
  head.appendChild(brand);
  return head;
}

async function openPanel(task: string, extra = ''): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.storage.session.set({ pending: { task, selection: extra } });
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
}

async function renderSignedIn(root: HTMLElement): Promise<void> {
  root.appendChild(header());

  const page = await currentPage();
  const ctx = el('div', 'ctx');
  ctx.appendChild(el('span', 'grow trunc', page.title || page.url || 'Sahifa'));
  if (page.words) ctx.appendChild(el('span', 'tiny', `${page.words} soʻz`));
  root.appendChild(ctx);

  root.appendChild(el('div', 'section', 'Tez amallar'));

  const list = el('div', 'pad');
  for (const action of QUICK) {
    const button = el('button', 'quick');
    button.appendChild(el('span', 'qi', action.icon));
    button.appendChild(el('span', 'grow', action.label));
    const kbd = el('kbd', '', action.key);
    button.appendChild(kbd);
    button.onclick = () => void openPanel(action.id, page.selection);
    list.appendChild(button);
  }
  root.appendChild(list);

  // Tezkor savol — yozib yuborilsa yon panelda javob keladi.
  const ask = el('div', 'ask');
  const input = el('input');
  input.placeholder = 'Sahifa haqida soʻrang…';
  const send = el('button', '', '↑');
  const fire = () => {
    if (input.value.trim()) void openPanel('savol:' + input.value.trim(), page.selection);
  };
  send.onclick = fire;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') fire();
  };
  ask.append(input, send);
  root.appendChild(ask);

  const foot = el('div', 'foot');
  const planChip = el('span', 'chip on', 'yuklanmoqda…');
  foot.appendChild(planChip);
  const open = el('button', 'tiny grow', 'Panelda ochish →');
  open.style.textAlign = 'right';
  open.onclick = () => void openPanel('');
  foot.appendChild(open);
  root.appendChild(foot);

  const q: Quota | null = await quota();
  planChip.textContent = q
    ? `${q.plan} · ${tokenLabel(q.tokensLeft)} qoldi`
    : 'ulanmadi';
  input.focus();
}

function renderSignIn(root: HTMLElement): void {
  const wrap = el('div', 'auth');
  wrap.appendChild(el('div', 'mark', 'D'));
  wrap.appendChild(el('h1', '', 'Daho hisobiga kiring'));
  wrap.appendChild(el('p', '', 'Ilovadagi hisobingiz shu yerda ham ishlaydi.'));

  const emailField = el('label', 'field');
  emailField.appendChild(el('span', '', 'Email'));
  const email = el('input');
  email.type = 'email';
  email.placeholder = 'siz@example.com';
  emailField.appendChild(email);

  const passField = el('label', 'field');
  passField.appendChild(el('span', '', 'Parol'));
  const password = el('input');
  password.type = 'password';
  passField.appendChild(password);

  const error = el('div', 'tiny');
  error.style.color = 'var(--danger)';

  const submit = el('button', 'btn wide', 'Kirish');
  const go = async () => {
    error.textContent = '';
    submit.disabled = true;
    try {
      await signIn(email.value, password.value);
      root.textContent = '';
      await renderSignedIn(root);
    } catch (err) {
      error.textContent = String((err as Error).message ?? err);
    } finally {
      submit.disabled = false;
    }
  };
  submit.onclick = () => void go();
  password.onkeydown = (e) => {
    if (e.key === 'Enter') void go();
  };

  wrap.append(emailField, passField, error, submit);
  root.appendChild(wrap);
  email.focus();
}

function renderSetup(root: HTMLElement): void {
  const wrap = el('div', 'auth');
  wrap.appendChild(el('div', 'mark', 'D'));
  wrap.appendChild(el('h1', '', 'Sozlash kerak'));
  wrap.appendChild(el('p', '', 'Kengaytma qaysi serverga ulanishini bilmayapti.'));
  const open = el('button', 'btn wide', 'Sozlash sahifasi');
  open.onclick = () => chrome.runtime.openOptionsPage();
  wrap.appendChild(open);
  root.appendChild(wrap);
}

async function main(): Promise<void> {
  const root = $('#root');
  if (!(await server())) return renderSetup(root);
  if (!(await session())) return renderSignIn(root);
  await renderSignedIn(root);
}

void main();
