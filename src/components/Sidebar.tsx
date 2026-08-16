import { createChat, deleteChat } from '../lib/agent';
import { setState, useStore } from '../lib/store';
import { relativeTime } from '../lib/utils';
import type { AgentSection } from './agent/sections';
import { AGENT_SECTIONS, SECTION_LABEL } from './agent/sections';
import {
  Calendar,
  Chat,
  Clock,
  Close,
  Folder,
  Layers,
  Note,
  Plus,
  Settings as SettingsIcon,
  Sparkle,
  Trash,
} from './Icons';

const SECTION_ICON: Record<AgentSection, JSX.Element> = {
  bugun: <Sparkle size={17} />,
  jadval: <Calendar size={17} />,
  vazifalar: <Chat size={17} />,
  loyihalar: <Folder size={17} />,
  konspekt: <Note size={17} />,
  vaqt: <Clock size={17} />,
  artifact: <Layers size={17} />,
};

interface Props {
  onClose: () => void;
  onOpenSettings: () => void;
  onGoChat: () => void;
  onGoAgent: (section: AgentSection) => void;
  activeSection: AgentSection;
  tab: 'chat' | 'agent';
}

export function Sidebar({
  onClose,
  onOpenSettings,
  onGoChat,
  onGoAgent,
  activeSection,
  tab,
}: Props) {
  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            Da<span>ho</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Yopish">
            <Close />
          </button>
        </div>

        <div className="sidebar-body">
          <button
            className="btn wide"
            onClick={() => {
              createChat();
              onGoChat();
              onClose();
            }}
          >
            <Plus size={17} /> Yangi suhbat
          </button>

          <div className="section-label">Agent</div>
          {AGENT_SECTIONS.map((s) => (
            <button
              key={s}
              className={tab === 'agent' && activeSection === s ? 'side-link on' : 'side-link'}
              onClick={() => {
                onGoAgent(s);
                onClose();
              }}
            >
              {SECTION_ICON[s]}
              {SECTION_LABEL[s]}
            </button>
          ))}

          <div className="section-label">Suhbatlar</div>
          {chats.length === 0 && (
            <div className="tiny" style={{ padding: '4px 11px' }}>
              Hali suhbat yoʻq
            </div>
          )}
          {chats.map((c) => (
            <div
              className={tab === 'chat' && c.id === activeChatId ? 'chat-row on' : 'chat-row'}
              key={c.id}
            >
              <button
                onClick={() => {
                  setState({ activeChatId: c.id });
                  onGoChat();
                  onClose();
                }}
              >
                {c.title}
                <div className="tiny">{relativeTime(c.updatedAt)}</div>
              </button>
              <button
                className="icon-btn"
                style={{ width: 30, height: 30 }}
                onClick={() => {
                  if (window.confirm(`"${c.title}" suhbati oʻchirilsinmi?`)) deleteChat(c.id);
                }}
                aria-label="Oʻchirish"
              >
                <Trash size={15} />
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <button
            className="side-link"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
          >
            <SettingsIcon size={17} />
            Sozlamalar
          </button>
        </div>
      </aside>
    </>
  );
}
