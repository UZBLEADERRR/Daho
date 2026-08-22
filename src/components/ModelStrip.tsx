import { useState } from 'react';
import { allCachedModels, parseRef, pickForJob } from '../lib/providers';
import { updateSettings, useStore } from '../lib/store';
import { Bolt, Chevron } from './Icons';
import { ModelPickerSheet } from './ModelPicker';

/**
 * Suhbat ustidagi ingichka qator: hozir qaysi model ishlayotgani.
 *
 * Auto yoqilgan boʻlsa Daho vazifaga qarab modelni oʻzi almashtiradi —
 * shuning uchun qaysi model tanlanganini koʻrsatib turish kerak, aks
 * holda foydalanuvchi javob sifati nega oʻzgarganini tushunmaydi.
 */
export function ModelStrip() {
  const model = useStore((s) => s.settings.model);
  const auto = useStore((s) => s.settings.autoPickModel !== false);
  const [open, setOpen] = useState(false);

  const effective = auto ? pickForJob('matn', model) : model;
  const found = allCachedModels().find((m) => m.id === effective);
  const label = found?.label ?? parseRef(effective).model ?? 'Model';

  return (
    <>
      <div className="model-strip">
        <button
          className={auto ? 'chip sm on' : 'chip sm'}
          onClick={() => updateSettings({ autoPickModel: !auto })}
          title={auto ? 'Avtomatik tanlash yoqilgan' : 'Avtomatik tanlash oʻchiq'}
        >
          <Bolt size={11} /> Avto
        </button>

        <button className="chip sm strip-model" onClick={() => setOpen(true)}>
          {label}
          <Chevron size={12} />
        </button>
      </div>

      {open && (
        <ModelPickerSheet
          title="Model tanlash"
          value={model}
          onPick={(id) => updateSettings({ model: id })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
