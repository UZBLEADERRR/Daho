import { useState } from 'react';
import type { Artifact } from '../lib/types';
import { useStore } from '../lib/store';
import { Apps } from './agent/Apps';
import { Artifacts } from './agent/Artifacts';
import { Automations } from './agent/Automations';
import { Books } from './agent/Books';
import { Connectors } from './agent/Connectors';
import { Courses } from './agent/Courses';
import { Notes } from './agent/Notes';
import { Overview } from './agent/Overview';
import { Projects } from './agent/Projects';
import { Schedule } from './agent/Schedule';
import { Tasks } from './agent/Tasks';
import { TimeTracker } from './agent/TimeTracker';
import {
  AGENT_SECTIONS,
  SECTION_EMOJI,
  SECTION_LABEL,
  type AgentSection,
} from './agent/sections';
import { VideoCard } from './VideoStudio';
import { Empty, Sheet } from './ui';

interface Props {
  section: AgentSection;
  onSection: (s: AgentSection) => void;
  onOpenArtifact: (a: Artifact) => void;
  onOpenVideo: (id: string) => void;
}

/**
 * Boʻlim tanlagich.
 *
 * Avval oʻn uchta boʻlim bitta uzun gorizontal qatorda turardi va
 * kerakligini topish uchun uzoq surish kerak edi — telefonda ayniqsa
 * noqulay. Endi bitta tugma: joriy boʻlim koʻrinib turadi, bosilsa
 * hammasi bir ekranda toʻr boʻlib chiqadi.
 */
function SectionPicker({
  section,
  onSection,
}: {
  section: AgentSection;
  onSection: (s: AgentSection) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="section-pick" onClick={() => setOpen(true)}>
        <span className="section-pick-emoji">{SECTION_EMOJI[section]}</span>
        <span className="grow">{SECTION_LABEL[section]}</span>
        <span className="section-pick-caret">▾</span>
      </button>

      {open && (
        <Sheet title="Boʻlimlar" onClose={() => setOpen(false)}>
          <div className="section-grid">
            {AGENT_SECTIONS.map((s) => (
              <button
                key={s}
                className={section === s ? 'section-tile on' : 'section-tile'}
                onClick={() => {
                  onSection(s);
                  setOpen(false);
                }}
              >
                <span className="section-tile-emoji">{SECTION_EMOJI[s]}</span>
                {SECTION_LABEL[s]}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

function Videos({ onOpenVideo }: { onOpenVideo: (id: string) => void }) {
  const videos = useStore((s) => s.videos);
  return (
    <div className="scroll">
      <div className="pad">
        {videos.length === 0 ? (
          <Empty
            title="Video yoʻq"
            hint="Chatda + tugmasidan «Video yasash» ni tanlang va mavzuni yozing."
          />
        ) : (
          videos.map((v) => <VideoCard key={v.id} projectId={v.id} onOpen={onOpenVideo} />)
        )}
      </div>
    </div>
  );
}

export function AgentView({ section, onSection, onOpenArtifact, onOpenVideo }: Props) {
  return (
    <>
      <SectionPicker section={section} onSection={onSection} />

      {section === 'bugun' && <Overview onNavigate={onSection} />}
      {section === 'kitoblar' && <Books onOpenArtifact={onOpenArtifact} />}
      {section === 'avto' && <Automations />}
      {section === 'ulanish' && <Connectors />}
      {section === 'kurslar' && <Courses onOpenArtifact={onOpenArtifact} />}
      {section === 'ilovalar' && <Apps />}
      {section === 'jadval' && <Schedule />}
      {section === 'vazifalar' && <Tasks />}
      {section === 'loyihalar' && <Projects />}
      {section === 'konspekt' && <Notes />}
      {section === 'vaqt' && <TimeTracker />}
      {section === 'videolar' && <Videos onOpenVideo={onOpenVideo} />}
      {section === 'artifact' && <Artifacts onOpen={onOpenArtifact} />}
    </>
  );
}
