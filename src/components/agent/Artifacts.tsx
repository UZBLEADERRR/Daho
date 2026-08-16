import { useState } from 'react';
import { setState, useStore } from '../../lib/store';
import type { Artifact } from '../../lib/types';
import { relativeTime } from '../../lib/utils';
import { ArtifactCard } from '../ArtifactView';
import { Empty } from '../ui';

type Filter = 'hammasi' | 'html' | 'image' | 'code';

const LABEL: Record<Filter, string> = {
  hammasi: 'Hammasi',
  html: 'Ilovalar',
  image: 'Rasmlar',
  code: 'Kodlar',
};

export function Artifacts({ onOpen }: { onOpen: (a: Artifact) => void }) {
  const artifacts = useStore((s) => s.artifacts);
  const [filter, setFilter] = useState<Filter>('hammasi');

  const visible = artifacts.filter((a) => {
    if (filter === 'hammasi') return true;
    if (filter === 'code') return a.kind === 'code' || a.kind === 'markdown';
    return a.kind === filter;
  });

  return (
    <div className="scroll">
      <div className="seg">
        {(Object.keys(LABEL) as Filter[]).map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {LABEL[f]}
          </button>
        ))}
      </div>

      <div className="pad">
        {visible.length === 0 ? (
          <Empty
            title="Artifact yoʻq"
            hint="Chatda “menga formulalar uchun test ilovasi yasab ber” deb soʻrang — natija shu yerda saqlanadi."
          />
        ) : (
          visible.map((a) => (
            <div key={a.id}>
              <ArtifactCard artifact={a} onOpen={onOpen} />
              <div className="row" style={{ margin: '-4px 2px 12px' }}>
                <span className="tiny grow">{relativeTime(a.createdAt)}</span>
                <button
                  className="tiny"
                  style={{ color: 'var(--danger)' }}
                  onClick={() =>
                    setState((s) => ({ artifacts: s.artifacts.filter((x) => x.id !== a.id) }))
                  }
                >
                  Oʻchirish
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
