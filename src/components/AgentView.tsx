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
import { AGENT_SECTIONS, SECTION_LABEL, type AgentSection } from './agent/sections';
import { VideoCard } from './VideoStudio';
import { Empty } from './ui';

interface Props {
  section: AgentSection;
  onSection: (s: AgentSection) => void;
  onOpenArtifact: (a: Artifact) => void;
  onOpenVideo: (id: string) => void;
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
      <div className="seg agent-seg">
        {AGENT_SECTIONS.map((s) => (
          <button key={s} className={section === s ? 'on' : ''} onClick={() => onSection(s)}>
            {SECTION_LABEL[s]}
          </button>
        ))}
      </div>

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
