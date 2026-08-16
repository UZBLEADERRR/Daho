import type { Artifact } from '../lib/types';
import { Artifacts } from './agent/Artifacts';
import { Notes } from './agent/Notes';
import { Overview } from './agent/Overview';
import { Projects } from './agent/Projects';
import { Schedule } from './agent/Schedule';
import { Tasks } from './agent/Tasks';
import { TimeTracker } from './agent/TimeTracker';
import { AGENT_SECTIONS, SECTION_LABEL, type AgentSection } from './agent/sections';

interface Props {
  section: AgentSection;
  onSection: (s: AgentSection) => void;
  onOpenArtifact: (a: Artifact) => void;
}

export function AgentView({ section, onSection, onOpenArtifact }: Props) {
  return (
    <>
      <div className="seg">
        {AGENT_SECTIONS.map((s) => (
          <button key={s} className={section === s ? 'on' : ''} onClick={() => onSection(s)}>
            {SECTION_LABEL[s]}
          </button>
        ))}
      </div>

      {section === 'bugun' && <Overview onNavigate={onSection} />}
      {section === 'jadval' && <Schedule />}
      {section === 'vazifalar' && <Tasks />}
      {section === 'loyihalar' && <Projects />}
      {section === 'konspekt' && <Notes />}
      {section === 'vaqt' && <TimeTracker />}
      {section === 'artifact' && <Artifacts onOpen={onOpenArtifact} />}
    </>
  );
}
