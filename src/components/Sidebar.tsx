import { useState } from 'react';
import { createChat, deleteChat } from '../lib/agent';
import { cloudEnabled, useCloud } from '../lib/cloud';
import { setState, useStore } from '../lib/store';
import { relativeTime } from '../lib/utils';
import type { AgentSection } from './agent/sections';
import { AGENT_SECTIONS, SECTION_EMOJI, SECTION_LABEL } from './agent/sections';
import { Close, Cloud, Plus, Settings as SettingsIcon, Shield, Trash } from './Icons';

interface Props {
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onOpenAdmin: () => void;
  onOpenBrowser: () => void;
  /** Keng ekranda yon panel doim ochiq turadi */
  pinned?: boolean;
  onGoChat: () => void;
  onGoCode: () => void;
  onGoAgent: (section: AgentSection) => void;
  activeSection: AgentSection;
  tab: 'chat' | 'agent' | 'kod';
}

export function Sidebar({
  onClose,
  onOpenSettings,
  onOpenAccount,
  onOpenAdmin,
  onOpenBrowser,
  onGoChat,
  onGoCode,
  onGoAgent,
  activeSection,
  tab,
  pinned = false,
}: Props) {
  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);
  const [agentOpen, setAgentOpen] = useState(() => {
    try {
      return localStorage.getItem('daho.side.agent') !== 'yigʻiq';
    } catch {
      return true;
    }
  });
  const cloud = useCloud();

  return (
    <>
      {!pinned && <div className="scrim" onClick={onClose} />}
      <aside className={pinned ? 'sidebar pinned' : 'sidebar'}>
        <div className="sidebar-head">
          <div className="brand">
            Da<span>ho</span>
          </div>
          {!pinned && (
            <button className="icon-btn" onClick={onClose} aria-label="Yopish">
              <Close />
            </button>
          )}
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

          <button
            className={tab === 'kod' ? 'side-link on' : 'side-link'}
            style={{ marginTop: 8 }}
            onClick={() => {
              onGoCode();
              onClose();
            }}
          >
            <span className="side-emoji">⌨️</span>
            Daho Code
          </button>

          <button
            className="side-link"
            onClick={() => {
              onOpenBrowser();
              onClose();
            }}
          >
            <span className="side-emoji">🌐</span>
            Brauzer
          </button>

          {/*
            * Agent boʻlimi yigʻiladi.
            *
            * Ichida oʻn beshdan ortiq havola bor va ular suhbatlar
            * roʻyxatini ekrandan chiqarib yuborardi. Tanlov saqlanadi.
            */}
          <button
            className="section-label section-toggle"
            onClick={() => {
              setAgentOpen((v) => {
                try {
                  localStorage.setItem('daho.side.agent', v ? 'yigʻiq' : 'ochiq');
                } catch {
                  /* xotira yopiq boʻlsa ham ishlayveradi */
                }
                return !v;
              });
            }}
            aria-expanded={agentOpen}
          >
            <span className="grow">Agent</span>
            <span className="side-caret">{agentOpen ? '▾' : '▸'}</span>
          </button>
          {agentOpen && AGENT_SECTIONS.map((s) => (
            <button
              key={s}
              className={tab === 'agent' && activeSection === s ? 'side-link on' : 'side-link'}
              onClick={() => {
                onGoAgent(s);
                onClose();
              }}
            >
              <span className="side-emoji">{SECTION_EMOJI[s]}</span>
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
          {cloudEnabled && (
            <button
              className="side-link"
              onClick={() => {
                onOpenAccount();
                onClose();
              }}
            >
              <Cloud size={17} />
              {cloud.account?.plan?.name
                ? `Daho Cloud · ${cloud.account.plan.name}`
                : 'Daho Cloud'}
            </button>
          )}

          {cloud.account?.is_admin && (
            <button
              className="side-link"
              onClick={() => {
                onOpenAdmin();
                onClose();
              }}
            >
              <Shield size={17} />
              Admin panel
            </button>
          )}

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
