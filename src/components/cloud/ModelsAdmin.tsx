/**
 * Admin → Modellar.
 *
 * Bu yerda «Dahonator» degan nom bilan haqiqiy model bogʻlanadi.
 * Admin OpenRouter katalogidan modelni topadi — TANNARXI koʻrinib
 * turadi — nom beradi va sotuv narxi ustama boʻyicha oʻzi hisoblanadi.
 *
 * Kalitlar bu yerda soʻralmaydi: ular Railway muhit oʻzgaruvchisida
 * turadi, panel faqat «bor / yoʻq» ni koʻrsatadi.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  aiModels,
  bootstrapCatalog,
  attachModel,
  creditRate,
  deleteAiModel,
  openrouterCatalog,
  providerStatus,
  saveAiModel,
  saveCreditRate,
  toCredits,
  unlistedModels,
  type AiModel,
  type CatalogModel,
  type CreditRate,
  type ProviderStatus,
  type UnlistedModel,
} from '../../lib/cloud/catalog';
import { adminPlans } from '../../lib/cloud/admin';
import type { CloudPlan } from '../../lib/cloud';
import { toast } from '../ui';

function fail(err: unknown): void {
  toast(String((err as Error)?.message ?? err));
}

const ROLES = ['chat', 'code', 'image', 'video', 'tts', 'embed', 'other'];

/** `$0.15` koʻrinishida — juda kichik narxlar ham koʻrinsin. */
function usd(value: number): string {
  const n = Number(value ?? 0);
  if (!n) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function boshHarf(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

/** Katalogdagi nomdan Daho uchun slug taklif qiladi. */
function slugTaklif(id: string): string {
  const tail = id.split('/').pop() ?? id;
  return `daho-${tail.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`;
}

/* ---------------------------------------------------------------- tahrir */

const BOSH: AiModel = {
  slug: '',
  label: '',
  description: '',
  provider: 'openrouter',
  upstream: '',
  role: 'chat',
  cost_input_usd: 0,
  cost_output_usd: 0,
  input_credits_per_mtok: 0,
  output_credits_per_mtok: 0,
  call_credits: 0,
  supports_tools: true,
  supports_vision: false,
  supports_stream: true,
  context_tokens: 0,
  enabled: true,
  is_daily: false,
  sort: 0,
};

function Editor({
  model,
  rate,
  plans,
  onDone,
  onCancel,
}: {
  model: AiModel;
  rate: CreditRate;
  plans: CloudPlan[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AiModel>(model);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof AiModel>(key: K, value: AiModel[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /*
   * Narxni admin qoʻlda kiritmasa — tannarxdan hisoblaymiz. Shu tufayli
   * «qancha ustama qoʻyyapman» degan savol koʻrinib turadi.
   */
  const taklifIn = toCredits(form.cost_input_usd, rate);
  const taklifOut = toCredits(form.cost_output_usd, rate);
  const kirish = form.input_credits_per_mtok || taklifIn;
  const chiqish = form.output_credits_per_mtok || taklifOut;

  const foyda = useMemo(() => {
    const tannarx = form.cost_input_usd + form.cost_output_usd;
    if (!tannarx) return 0;
    const sotuv = (kirish + chiqish) * rate.usd_per_credit;
    return Math.round(((sotuv - tannarx) / tannarx) * 100);
  }, [form.cost_input_usd, form.cost_output_usd, kirish, chiqish, rate.usd_per_credit]);

  const saqla = async () => {
    if (!form.slug.trim()) return toast('Daho nomi (slug) kerak');
    if (!form.upstream.trim()) return toast('Provayderdagi model nomi kerak');
    setBusy(true);
    try {
      await saveAiModel({
        ...form,
        slug: form.slug.trim().toLowerCase(),
        label: form.label.trim() || boshHarf(form.slug.trim()),
        input_credits_per_mtok: kirish,
        output_credits_per_mtok: chiqish,
      });
      if (chosen.length) await attachModel(form.slug.trim().toLowerCase(), chosen);
      toast('Saqlandi');
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row">
        <label className="mini-field grow">
          Daho nomi (slug)
          <input
            value={form.slug}
            onChange={(e) => set('slug', e.target.value)}
            placeholder="dahonator"
          />
        </label>
        <label className="mini-field grow">
          Koʻrinadigan nom
          <input
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder="Dahonator"
          />
        </label>
      </div>

      <div className="row">
        <label className="mini-field">
          Provayder
          <select
            value={form.provider}
            onChange={(e) => set('provider', e.target.value as AiModel['provider'])}
          >
            <option value="openrouter">OpenRouter</option>
            <option value="google">Google</option>
          </select>
        </label>
        <label className="mini-field grow">
          Haqiqiy model
          <input
            value={form.upstream}
            onChange={(e) => set('upstream', e.target.value)}
            placeholder="moonshotai/kimi-k2"
          />
        </label>
        <label className="mini-field">
          Roli
          <select value={form.role} onChange={(e) => set('role', e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mini-field">
        Izoh (foydalanuvchi koʻradi)
        <input
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Tez va arzon — kundalik savollar uchun"
        />
      </label>

      <div className="section-label">Tannarx — provayder soʻraydi (USD / 1M token)</div>
      <div className="row">
        <label className="mini-field grow">
          kirish
          <input
            type="number"
            step="0.0001"
            value={form.cost_input_usd}
            onChange={(e) => set('cost_input_usd', Number(e.target.value))}
          />
        </label>
        <label className="mini-field grow">
          chiqish
          <input
            type="number"
            step="0.0001"
            value={form.cost_output_usd}
            onChange={(e) => set('cost_output_usd', Number(e.target.value))}
          />
        </label>
      </div>

      <div className="section-label">
        Sotuv narxi — kredit / 1M token{' '}
        {foyda > 0 ? <span className="tiny">· foyda ≈ {foyda}%</span> : null}
      </div>
      <div className="row">
        <label className="mini-field grow">
          kirish
          <input
            type="number"
            value={kirish}
            onChange={(e) => set('input_credits_per_mtok', Number(e.target.value))}
          />
        </label>
        <label className="mini-field grow">
          chiqish
          <input
            type="number"
            value={chiqish}
            onChange={(e) => set('output_credits_per_mtok', Number(e.target.value))}
          />
        </label>
        <label className="mini-field grow">
          chaqiruv
          <input
            type="number"
            value={form.call_credits}
            onChange={(e) => set('call_credits', Number(e.target.value))}
          />
        </label>
      </div>
      <div className="tiny">
        Boʻsh qoldirsangiz tannarxdan ×{rate.markup} qilib hisoblanadi ({taklifIn} / {taklifOut}).
      </div>

      <div className="section-label">Imkoniyatlari</div>
      <div className="row wrap">
        <button
          className={`btn mini ${form.supports_tools ? '' : 'ghost'}`}
          onClick={() => set('supports_tools', !form.supports_tools)}
        >
          Tool ishlatadi
        </button>
        <button
          className={`btn mini ${form.supports_vision ? '' : 'ghost'}`}
          onClick={() => set('supports_vision', !form.supports_vision)}
        >
          Rasm koʻradi
        </button>
        <button
          className={`btn mini ${form.enabled ? '' : 'ghost'}`}
          onClick={() => set('enabled', !form.enabled)}
        >
          {form.enabled ? 'Yoqilgan' : 'Oʻchirilgan'}
        </button>
        <button
          className={`btn mini ${form.is_daily ? '' : 'ghost'}`}
          onClick={() => set('is_daily', !form.is_daily)}
          title="Limit tugaganda ishlaydigan bepul model"
        >
          Daho Daily
        </button>
      </div>

      <div className="section-label">Qaysi tariflarga ochilsin</div>
      <div className="row wrap">
        {plans.map((p) => (
          <button
            key={p.id}
            className={`btn mini ${chosen.includes(p.id) ? '' : 'ghost'}`}
            onClick={() =>
              setChosen((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))
            }
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn grow" disabled={busy} onClick={() => void saqla()}>
          {busy ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Bekor
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- katalog */

function Catalog({ onPick }: { onPick: (m: CatalogModel) => void }) {
  const [list, setList] = useState<CatalogModel[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [faqatTool, setFaqatTool] = useState(false);
  const [faqatBepul, setFaqatBepul] = useState(false);

  const load = (force = false) => {
    setList(null);
    setError('');
    openrouterCatalog(force)
      .then(setList)
      .catch((err) => setError(String((err as Error)?.message ?? err)));
  };

  useEffect(() => load(), []);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (list ?? [])
      .filter((m) => !faqatTool || m.supports_tools)
      .filter((m) => !faqatBepul || m.free)
      .filter((m) => !term || m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term))
      .slice(0, 80);
  }, [list, q, faqatTool, faqatBepul]);

  if (error) {
    return (
      <div className="card">
        <div className="tiny">{error}</div>
        <button className="btn mini ghost" style={{ marginTop: 8 }} onClick={() => load(true)}>
          Qayta urinish
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="row">
        <input
          className="grow"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="qidiruv: kimi, qwen, gpt, claude…"
        />
        <button className="btn mini ghost" onClick={() => load(true)}>
          Yangilash
        </button>
      </div>
      <div className="row wrap" style={{ marginTop: 6 }}>
        <button
          className={`btn mini ${faqatTool ? '' : 'ghost'}`}
          onClick={() => setFaqatTool(!faqatTool)}
        >
          Tool ishlatadiganlar
        </button>
        <button
          className={`btn mini ${faqatBepul ? '' : 'ghost'}`}
          onClick={() => setFaqatBepul(!faqatBepul)}
        >
          Bepullari
        </button>
        <span className="tiny">
          {list ? `${shown.length} / ${list.length}` : 'yuklanmoqda…'}
        </span>
      </div>

      {shown.map((m) => (
        <div className="line-row" key={m.id}>
          <div className="grow">
            <div>{m.name}</div>
            <div className="tiny">
              {m.id} · {(m.context / 1000).toFixed(0)}k kontekst
              {m.supports_tools ? ' · tool' : ''}
              {m.supports_vision ? ' · rasm' : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="tiny">
              {m.free ? 'bepul' : `${usd(m.input_usd)} / ${usd(m.output_usd)}`}
            </div>
            <button className="btn mini" style={{ marginTop: 4 }} onClick={() => onPick(m)}>
              Qoʻshish
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- asosiy */

export function ModelsAdmin() {
  const [models, setModels] = useState<AiModel[]>([]);
  const [plans, setPlans] = useState<CloudPlan[]>([]);
  const [rate, setRate] = useState<CreditRate>({ usd_per_credit: 0.00002, markup: 2 });
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [providerError, setProviderError] = useState('');
  const [unlisted, setUnlisted] = useState<UnlistedModel[]>([]);
  const [editing, setEditing] = useState<AiModel | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [bootBusy, setBootBusy] = useState(false);

  const load = () => {
    void aiModels().then(setModels).catch(fail);
    void unlistedModels().then(setUnlisted).catch(() => setUnlisted([]));
    void adminPlans().then(setPlans).catch(fail);
    void creditRate().then(setRate).catch(fail);
    void providerStatus()
      .then(setProviders)
      .catch((err) => setProviderError(String((err as Error)?.message ?? err)));
  };

  useEffect(load, []);

  const pick = (m: CatalogModel) => {
    setShowCatalog(false);
    setEditing({
      ...BOSH,
      slug: slugTaklif(m.id),
      label: m.name,
      description: m.description.slice(0, 120),
      provider: 'openrouter',
      upstream: m.id,
      cost_input_usd: Number(m.input_usd.toFixed(6)),
      cost_output_usd: Number(m.output_usd.toFixed(6)),
      supports_tools: m.supports_tools,
      supports_vision: m.supports_vision,
      context_tokens: m.context,
    });
  };

  return (
    <div>
      {/* --- provayder kalitlari --- */}
      <div className="section-label">Provayder kalitlari (Railway muhitida)</div>
      {providerError ? (
        <div className="tiny">{providerError}</div>
      ) : !providers ? (
        <div className="tiny">Tekshirilmoqda…</div>
      ) : (
        <div className="row wrap">
          <span className={`chip ${providers.openrouter.key ? 'ok' : 'warn'}`}>
            OpenRouter: {providers.openrouter.key ? 'ulangan' : 'OPENROUTER_API_KEY yoʻq'}
          </span>
          <span className={`chip ${providers.google.key ? 'ok' : 'warn'}`}>
            Google: {providers.google.key ? 'ulangan' : 'GEMINI_API_KEY yoʻq'}
          </span>
        </div>
      )}
      <div className="tiny" style={{ marginTop: 6 }}>
        Kalitlar bazaga yozilmaydi va bu yerdan koʻrinmaydi — faqat serverda turadi.
      </div>

      {/* --- kredit kursi --- */}
      <div className="section-label">Kredit kursi</div>
      <div className="row">
        <label className="mini-field grow">
          1 kredit = USD
          <input
            type="number"
            step="0.000001"
            value={rate.usd_per_credit}
            onChange={(e) => setRate({ ...rate, usd_per_credit: Number(e.target.value) })}
          />
        </label>
        <label className="mini-field grow">
          ustama (×)
          <input
            type="number"
            step="0.1"
            value={rate.markup}
            onChange={(e) => setRate({ ...rate, markup: Number(e.target.value) })}
          />
        </label>
        <button
          className="btn mini"
          onClick={() =>
            void saveCreditRate(rate)
              .then(() => toast('Saqlandi'))
              .catch(fail)
          }
        >
          Saqlash
        </button>
      </div>
      <div className="tiny">
        Misol: tannarx $1 / 1M token → {toCredits(1, rate).toLocaleString('ru-RU')} kredit.
      </div>

      {/* --- bizning modellar --- */}
      <div className="section-label">Daho modellari</div>
      {!models.length && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="tiny" style={{ marginBottom: 8 }}>
            Hali model qoʻshilmagan — shuning uchun foydalanuvchilar hisob orqali
            ishlata olmaydi. Tugmani bosing: OpenRouter roʻyxatidan uchta model
            (bepul zaxira, tezkor va kuchli) tanlanib, barcha tarifga ochiladi.
          </div>
          <button
            className="btn wide"
            disabled={bootBusy}
            onClick={() => {
              setBootBusy(true);
              void bootstrapCatalog()
                .then((r) => {
                  toast(`${r.qoshildi.length} ta model qoʻshildi`);
                  load();
                })
                .catch(fail)
                .finally(() => setBootBusy(false));
            }}
          >
            {bootBusy ? 'Sozlanmoqda…' : 'Tez sozlash'}
          </button>
        </div>
      )}
      {models.map((m) => (
        <div className="line-row" key={m.slug}>
          <div className="grow">
            <div>
              {m.label || m.slug} {m.is_daily ? '· Daily' : ''}{' '}
              {m.enabled ? '' : <span className="tiny">(oʻchiq)</span>}
            </div>
            <div className="tiny">
              {m.provider} → {m.upstream} · {m.role}
              {m.supports_tools ? ' · tool' : ''}
              {m.supports_vision ? ' · rasm' : ''}
            </div>
            <div className="tiny">
              tannarx {usd(m.cost_input_usd)}/{usd(m.cost_output_usd)} · sotuv{' '}
              {Number(m.input_credits_per_mtok).toLocaleString('ru-RU')}/
              {Number(m.output_credits_per_mtok).toLocaleString('ru-RU')} kredit
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button className="btn mini ghost" onClick={() => setEditing(m)}>
              Tahrir
            </button>
            <button
              className="btn mini ghost"
              style={{ marginTop: 4 }}
              onClick={() => {
                if (!confirm(`«${m.label || m.slug}» oʻchirilsinmi?`)) return;
                void deleteAiModel(m.slug).then(load).catch(fail);
              }}
            >
              Oʻchirish
            </button>
          </div>
        </div>
      ))}

      {/* --- katalogdan tashqarida qolganlar --- */}
      {unlisted.length > 0 && (
        <>
          <div className="section-label">Katalogda yoʻq ({unlisted.length})</div>
          <div className="tiny" style={{ marginBottom: 6 }}>
            Bular rejada ochiq, lekin katalogga kiritilmagan — provayderi
            nomaʼlum va narxi eski oʻlchovda. Katalogga koʻchiring.
          </div>
          {unlisted.map((m) => (
            <div className="line-row dim" key={m.model}>
              <div className="grow">
                <div>{m.model}</div>
                <div className="tiny">
                  {m.plans} ta rejada · {Number(m.output_credits_per_mtok).toLocaleString('ru-RU')}{' '}
                  kredit / 1M
                </div>
              </div>
              <button
                className="btn mini"
                onClick={() =>
                  setEditing({
                    ...BOSH,
                    slug: m.model,
                    label: m.model,
                    role: m.role || 'chat',
                    provider: m.model.includes('/') ? 'openrouter' : 'google',
                    upstream: m.model,
                    input_credits_per_mtok: m.input_credits_per_mtok,
                    output_credits_per_mtok: m.output_credits_per_mtok,
                  })
                }
              >
                Katalogga
              </button>
            </div>
          ))}
        </>
      )}

      {editing && (
        <Editor
          model={editing}
          rate={rate}
          plans={plans}
          onDone={() => {
            setEditing(null);
            load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn grow" onClick={() => setShowCatalog(!showCatalog)}>
          {showCatalog ? 'Katalogni yopish' : 'OpenRouter katalogidan qoʻshish'}
        </button>
        <button className="btn ghost" onClick={() => setEditing({ ...BOSH })}>
          Qoʻlda
        </button>
      </div>

      {showCatalog && (
        <>
          <div className="section-label">OpenRouter katalogi — narxi bilan</div>
          <Catalog onPick={pick} />
        </>
      )}
    </div>
  );
}
