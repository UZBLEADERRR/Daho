/** Server manzilini qoʻlda kiritish (yigʻishda berilmagan boʻlsa). */

import { server, setServer } from './lib/config';
import { $, el } from './lib/ui';

async function render() {
  const root = $('#root');
  const current = await server();

  const wrap = el('div', 'auth');
  wrap.appendChild(el('div', 'mark', 'D'));

  const title = el('h1', '', 'Daho serveri');
  const hint = el(
    'p',
    '',
    'Kengaytma qaysi Daho serveriga ulanishini koʻrsating. Bu maʼlumotni admindan olasiz.',
  );
  wrap.append(title, hint);

  const urlField = el('label', 'field');
  urlField.appendChild(el('span', '', 'Server manzili'));
  const url = el('input');
  url.placeholder = 'https://xxxx.supabase.co';
  url.value = current?.url ?? '';
  urlField.appendChild(url);

  const keyField = el('label', 'field');
  keyField.appendChild(el('span', '', 'Ochiq (anon) kalit'));
  const key = el('input');
  key.placeholder = 'eyJhbGciOi…';
  key.value = current?.anonKey ?? '';
  keyField.appendChild(key);

  const save = el('button', 'btn wide', 'Saqlash');
  const note = el('p', 'tiny', '');

  save.onclick = async () => {
    if (!url.value.trim() || !key.value.trim()) {
      note.textContent = 'Ikkalasini ham toʻldiring.';
      return;
    }
    await setServer(url.value, key.value);
    note.textContent = 'Saqlandi. Kengaytmani qayta oching.';
  };

  wrap.append(urlField, keyField, save, note);
  root.appendChild(wrap);
}

void render();
