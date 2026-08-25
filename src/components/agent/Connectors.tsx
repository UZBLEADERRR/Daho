import { useState } from 'react';
import {
  CONNECTOR_PRESETS,
  callConnector,
  connectorFromPreset,
  deleteConnector,
  listConnectors,
  saveConnector,
  type ConnectorPreset,
} from '../../lib/connectors';
import { useStore } from '../../lib/store';
import type { Connector, ConnectorAction } from '../../lib/types';
import { Close, Trash } from '../Icons';
import { Empty, Sheet, Switch, toast } from '../ui';

export function Connectors() {
  const connectors = useStore((s) => s.settings.connectors ?? []);
  const [adding, setAdding] = useState<ConnectorPreset | null>(null);
  const [editing, setEditing] = useState<Connector | null>(null);

  return (
    <div className="scroll">
      <div className="pad">
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
          Ulangan xizmatlarga Daho oʻzi soʻrov yubora oladi: «bugungi rejani
          telegramga tashla», «bu konspektni Notionga yoz», «chiroqni oʻchir».
          Kalitlar faqat shu qurilmada qoladi — bulutga chiqmaydi.
        </p>

        {connectors.length === 0 ? (
          <Empty
            title="Ulanish yoʻq"
            hint="Pastdan xizmat tanlang — bir daqiqada ulanadi."
          />
        ) : (
          connectors.map((c) => (
            <div className="conn-row" key={c.id}>
              <span className="conn-icon">{c.icon}</span>
              <button className="grow" style={{ textAlign: 'left' }} onClick={() => setEditing(c)}>
                <div style={{ fontSize: 15, fontWeight: 560 }}>{c.name}</div>
                <div className="tiny" style={{ marginTop: 2 }}>
                  {c.actions.length} ta amal · {c.enabled ? 'yoqilgan' : 'oʻchirilgan'}
                </div>
              </button>
              <span className="conn-dot" data-on={c.enabled && Boolean(c.baseUrl)} />
            </div>
          ))
        )}

        <div className="section-label" style={{ padding: '18px 0 8px' }}>
          Xizmat ulash
        </div>
        <div className="conn-grid">
          {CONNECTOR_PRESETS.map((p) => (
            <button className="conn-card" key={p.id} onClick={() => setAdding(p)}>
              <span className="conn-card-icon">{p.icon}</span>
              <b>{p.name}</b>
              <i>{p.hint}</i>
            </button>
          ))}
        </div>
      </div>

      {adding && (
        <AddSheet
          preset={adding}
          onClose={() => setAdding(null)}
          onDone={(c) => {
            saveConnector(c);
            setAdding(null);
            setEditing(c);
          }}
        />
      )}

      {editing && (
        <EditSheet
          connector={editing}
          onClose={() => setEditing(null)}
          onDelete={() => {
            deleteConnector(editing.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AddSheet({
  preset,
  onClose,
  onDone,
}: {
  preset: ConnectorPreset;
  onClose: () => void;
  onDone: (c: Connector) => void;
}) {
  const [secret, setSecret] = useState('');
  const [extra, setExtra] = useState('');
  const twoFields = ['telegram', 'notion', 'airtable', 'homeassistant'].includes(preset.id);

  return (
    <Sheet title={`${preset.icon} ${preset.name}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{preset.hint}</p>
      <div className="tiny" style={{ marginBottom: 12 }}>Kerak: {preset.needs}</div>

      <div className="field">
        <label>{twoFields ? 'Token / kalit' : 'Manzil'}</label>
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value.trim())}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={twoFields ? '' : 'https://…'}
        />
      </div>

      {twoFields && (
        <div className="field">
          <label>
            {preset.id === 'telegram'
              ? 'Chat ID'
              : preset.id === 'homeassistant'
                ? 'Server manzili'
                : 'Baza ID'}
          </label>
          <input
            value={extra}
            onChange={(e) => setExtra(e.target.value.trim())}
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      )}

      <button
        className="btn wide"
        disabled={!secret}
        onClick={() => onDone(connectorFromPreset(preset, secret, extra))}
      >
        Ulash
      </button>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function EditSheet({
  connector,
  onClose,
  onDelete,
}: {
  connector: Connector;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Connector>(connector);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<string>('');

  const patch = (p: Partial<Connector>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    saveConnector(next);
  };

  const patchAction = (id: string, p: Partial<ConnectorAction>) =>
    patch({ actions: draft.actions.map((a) => (a.id === id ? { ...a, ...p } : a)) });

  const test = async (action: ConnectorAction) => {
    setTesting(action.id);
    setResult('');
    try {
      const res = await callConnector(draft, action, {});
      setResult(
        res.ok
          ? `✅ ${res.status} — xizmat javob berdi\n${res.body.slice(0, 300)}`
          : `❌ ${res.status}\n${res.body.slice(0, 300)}`,
      );
    } catch (err) {
      setResult(`❌ ${String((err as Error)?.message ?? err)}`);
    }
    setTesting(null);
  };

  return (
    <Sheet title={`${draft.icon} ${draft.name}`} onClose={onClose}>
      <Switch
        on={draft.enabled}
        onChange={(on) => patch({ enabled: on })}
        label="Ulanish yoqilgan"
        hint="Oʻchirilsa agent bu xizmatni koʻrmaydi."
      />

      <div className="field">
        <label>Nomi (agent shu nom bilan chaqiradi)</label>
        <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
      </div>

      <div className="field">
        <label>Asosiy manzil</label>
        <input
          value={draft.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value.trim() })}
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label>Kalit turi</label>
        <select
          value={draft.auth.kind}
          onChange={(e) =>
            patch({ auth: { ...draft.auth, kind: e.target.value as Connector['auth']['kind'] } })
          }
        >
          <option value="yoq">Kerak emas (manzilning oʻzida)</option>
          <option value="bearer">Bearer token</option>
          <option value="header">Sarlavhada</option>
          <option value="query">Manzil oxirida</option>
        </select>
      </div>

      {(draft.auth.kind === 'header' || draft.auth.kind === 'query') && (
        <div className="field">
          <label>Kalit nomi</label>
          <input
            value={draft.auth.name ?? ''}
            onChange={(e) => patch({ auth: { ...draft.auth, name: e.target.value.trim() } })}
            placeholder="X-Api-Key"
          />
        </div>
      )}

      {draft.auth.kind !== 'yoq' && (
        <div className="field">
          <label>Kalit qiymati</label>
          <input
            type="password"
            value={draft.auth.value ?? ''}
            onChange={(e) => patch({ auth: { ...draft.auth, value: e.target.value.trim() } })}
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      )}

      <div className="section-label" style={{ padding: '14px 0 6px' }}>
        Amallar
      </div>

      {draft.actions.map((a) => (
        <div className="card" key={a.id} style={{ marginBottom: 10 }}>
          <div className="field">
            <label>Nomi</label>
            <input value={a.name} onChange={(e) => patchAction(a.id, { name: e.target.value })} />
          </div>
          <div className="field">
            <label>Agent uchun izoh — qachon ishlatilsin, qaysi maydonlar kerak</label>
            <textarea
              value={a.description}
              onChange={(e) => patchAction(a.id, { description: e.target.value })}
            />
          </div>
          <div className="field-row">
            <div className="field" style={{ maxWidth: 120 }}>
              <label>Usul</label>
              <select
                value={a.method}
                onChange={(e) =>
                  patchAction(a.id, { method: e.target.value as ConnectorAction['method'] })
                }
              >
                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Yoʻl</label>
              <input
                value={a.path}
                onChange={(e) => patchAction(a.id, { path: e.target.value })}
                placeholder="/sendMessage"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
          </div>
          {a.method !== 'GET' && a.method !== 'DELETE' && (
            <div className="field">
              <label>JSON tanasi — {'{{maydon}}'} oʻrniga qiymat qoʻyiladi</label>
              <textarea
                value={a.bodyTemplate ?? ''}
                onChange={(e) => patchAction(a.id, { bodyTemplate: e.target.value })}
                spellCheck={false}
                style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}
              />
            </div>
          )}
          <div className="row">
            <button
              className="btn ghost mini grow"
              disabled={testing !== null}
              onClick={() => void test(a)}
            >
              {testing === a.id ? 'Sinalmoqda…' : 'Sinab koʻrish'}
            </button>
            <button
              className="btn ghost mini"
              aria-label="Amalni oʻchirish"
              onClick={() => patch({ actions: draft.actions.filter((x) => x.id !== a.id) })}
            >
              <Close size={14} />
            </button>
          </div>
        </div>
      ))}

      <button
        className="btn ghost wide"
        onClick={() =>
          patch({
            actions: [
              ...draft.actions,
              {
                id: `act_${Date.now().toString(36)}`,
                name: 'yangi amal',
                description: 'Nima qilishini shu yerda yozing — agent shuni oʻqiydi.',
                method: 'POST',
                path: '',
                bodyTemplate: '{\n  "matn": "{{text}}"\n}',
              },
            ],
          })
        }
      >
        + Amal qoʻshish
      </button>

      {result && (
        <pre className="conn-result" style={{ marginTop: 12 }}>
          {result}
        </pre>
      )}

      <button
        className="btn ghost wide"
        style={{ marginTop: 14, color: 'var(--danger)' }}
        onClick={() => {
          if (window.confirm(`«${draft.name}» ulanishi oʻchirilsinmi?`)) {
            onDelete();
            toast('Ulanish oʻchirildi');
          }
        }}
      >
        <Trash size={15} /> Ulanishni oʻchirish
      </button>
    </Sheet>
  );
}

/** Boshqa joylardan ulanishlar sonini bilish uchun. */
export function connectorCount(): number {
  return listConnectors().length;
}
