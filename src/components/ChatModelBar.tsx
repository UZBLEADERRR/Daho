/**
 * Suhbat tepasidagi model tanlagichi.
 *
 * Oddiy foydalanuvchi Sozlamalarga kirib model qidirmasligi kerak —
 * unga admin ochib bergan modellar shu yerda, bir bosishda koʻrinadi.
 * Yopiq modellar ham koʻrsatiladi: «bu qaysi tarifda ochiladi?»
 * degan savol javobsiz qolmasin.
 */
import { useEffect, useState } from 'react';
import { publicCatalog, type PublicModel } from '../lib/cloud/catalog';
import { noteCatalogNames } from '../lib/agent';
import { cloudEnabled, useCloud } from '../lib/cloud';
import { updateSettings, useStore } from '../lib/store';
import { usableChatModels } from '../lib/providers';
import { Sheet, toast } from './ui';

const ROLE_EMOJI: Record<string, string> = {
  chat: '💬',
  code: '⌨️',
  image: '🖼',
  video: '🎬',
  tts: '🔊',
};

export function ChatModelBar() {
  const model = useStore((s) => s.settings.model);
  const { account } = useCloud();
  const [list, setList] = useState<PublicModel[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!cloudEnabled) {
      setList([]);
      return;
    }
    void publicCatalog()
      .then((rows) => {
        setList(rows);
        // Model oʻzini shu nom bilan tanitadi — provayder nomi bilan emas.
        noteCatalogNames(rows.map((r) => ({ slug: r.slug, label: r.label })));
      })
      .catch(() => setList([]));
  }, []);

  /*
   * Tanlangan model ruxsat etilganlar ichida boʻlmasa — birinchi
   * ochiq modelga oʻtkazamiz.
   *
   * Bu ham haqiqiy nosozlikdan chiqdi: qurilmada eski model nomi
   * qolib ketgan edi (masalan avvalgi egasi tanlagan), va yuqorida
   * «Model tanlash» deb turaverardi — soʻrov esa allaqachon boshqa
   * modelga ketardi.
   */
  useEffect(() => {
    if (!list?.length) return;
    const ochiqlar = list.filter((m) => m.open);
    if (!ochiqlar.length) return;
    if (ochiqlar.some((m) => m.slug === model)) return;
    updateSettings({ model: ochiqlar[0].slug });
  }, [list, model]);

  /*
   * Bulut katalogi boʻsh boʻlsa (admin hali model qoʻshmagan yoki
   * ilova oʻz kaliti bilan ishlayapti) qator YOʻQOLMASIN: shunda
   * modelni umuman almashtirib boʻlmasdi. Bunday holda ulangan
   * provayderlarning modellari koʻrsatiladi.
   */
  /*
   * Zaxira roʻyxat FAQAT ishlab chiquvchi uchun.
   *
   * Oddiy foydalanuvchi provayderdagi haqiqiy nomlarni koʻrmasligi
   * kerak — unga faqat admin ochib bergan «Daho» modellari. Shuning
   * uchun bulut yoqilgan va odam admin boʻlmasa zaxira ishlamaydi.
   */
  const ishlabChiquvchi = !cloudEnabled || Boolean(account?.is_admin);

  const mahalliy: PublicModel[] = list?.length || !ishlabChiquvchi
    ? []
    : usableChatModels().map((m) => ({
        slug: m.id,
        label: m.label,
        description: m.providerLabel ?? '',
        role: 'chat',
        open: true,
        is_daily: false,
        supports_tools: false,
        supports_vision: false,
        context_tokens: 0,
        // Oʻz kaliti bilan ishlanganda kredit yechilmaydi.
        input_credits_per_mtok: 0,
        output_credits_per_mtok: 0,
        call_credits: 0,
      }));

  const hammasi = list?.length ? list : mahalliy;
  if (!hammasi.length) return null;

  const ochiq = hammasi.filter((m) => m.open);
  const yopiq = hammasi.filter((m) => !m.open);
  const joriy = hammasi.find((m) => m.slug === model);

  return (
    <>
      <button className="model-bar" onClick={() => setOpen(true)}>
        <span className="model-bar-dot" />
        <span className="grow">{joriy?.label ?? 'Model tanlash'}</span>
        <span className="model-bar-caret">▾</span>
      </button>

      {open && (
        <Sheet title="Model tanlash" onClose={() => setOpen(false)}>
          {ochiq.map((m) => (
            <button
              key={m.slug}
              className={`line-row model-row${m.slug === model ? ' on' : ''}`}
              onClick={() => {
                updateSettings({ model: m.slug });
                setOpen(false);
              }}
            >
              <span className="model-emoji">{ROLE_EMOJI[m.role] ?? '💬'}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <div>
                  {m.label}
                  {m.is_daily ? ' · bepul' : ''}
                </div>
                <div className="tiny">
                  {[
                    m.description,
                    m.supports_tools ? 'vosita ishlatadi' : '',
                    m.supports_vision ? 'rasm koʻradi' : '',
                    m.context_tokens ? `${Math.round(m.context_tokens / 1000)}k kontekst` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </span>
            </button>
          ))}

          {yopiq.length > 0 && (
            <>
              <div className="section-label">Yuqori tarifda ochiladi</div>
              {yopiq.map((m) => (
                <button
                  key={m.slug}
                  className="line-row model-row dim"
                  onClick={() => toast(`«${m.label}» yuqori tarifda ochiladi`)}
                >
                  <span className="model-emoji">🔒</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <div>{m.label}</div>
                    <div className="tiny">{m.description}</div>
                  </span>
                </button>
              ))}
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
