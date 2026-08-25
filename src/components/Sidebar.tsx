import { useState } from 'react';
import { createChat, deleteChat } from '../lib/agent';
import { cloudEnabled, useCloud } from '../lib/cloud';
import { setState, useStore } from '../lib/store';
import { relativeTime } from '../lib/utils';
import type { AgentSection } from './agent/sections';
import { AGENT_SECTIONS, SECTION_EMOJI, SECTION_LABEL } from './agent/sections';
import { Close, Cloud, Plus, Shield, Trash } from './Icons';

interface Props {
  onClose: () => void;
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
  /** Qaysi suhbatning menyusi ochiq / qaysisi tahrirlanmoqda. */
  const [menu, setMenu] = useState<string | null>(null);
  const [tahrir, setTahrir] = useState<string | null>(null);

  const saqla = (id: string, nom: string) => {
    const yangi = nom.trim();
    setTahrir(null);
    if (!yangi) return;
    setState((s) => ({
      chats: s.chats.map((c) => (c.id === id ? { ...c, title: yangi.slice(0, 80) } : c)),
    }));
  };

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
              {tahrir === c.id ? (
                /*
                 * Nomni joyida tahrirlash. Alohida oyna ochilmaydi:
                 * suhbat nomini oʻzgartirish — bir soniyalik ish.
                 */
                <input
                  className="chat-rename"
                  autoFocus
                  defaultValue={c.title}
                  onBlur={(e) => saqla(c.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saqla(c.id, e.currentTarget.value);
                    if (e.key === 'Escape') setTahrir(null);
                  }}
                />
              ) : (
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
              )}

              <button
                className="icon-btn chat-more"
                style={{ width: 30, height: 30 }}
                onClick={() => setMenu(menu === c.id ? null : c.id)}
                aria-label="Amallar"
              >
                ⋯
              </button>

              {menu === c.id && (
                <div className="chat-menu">
                  <button
                    onClick={() => {
                      setMenu(null);
                      setTahrir(c.id);
                    }}
                  >
                    ✏️ Nomini oʻzgartirish
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      setMenu(null);
                      if (window.confirm(`«${c.title}» suhbati oʻchirilsinmi?`)) deleteChat(c.id);
                    }}
                  >
                    <Trash size={14} /> Oʻchirish
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          {/*
            * Profil qatori.
            *
            * Ilgari bu yerda «Daho Cloud · Pro» deb turardi — odam
            * «profil» ni qidirib topolmasdi. Endi tanish koʻrinish:
            * avatar, ism, pochta. Bosilsa profil ekrani ochiladi.
            */}
          {cloudEnabled && cloud.account && (
            <button
              className="side-me"
              onClick={() => {
                onOpenAccount();
                onClose();
              }}
            >
              <span className="side-avatar">
                {(cloud.account.full_name || cloud.account.email || '?')
                  .trim()
                  .charAt(0)
                  .toUpperCase()}
              </span>
              <span className="side-me-text">
                <b>{cloud.account.full_name || cloud.account.email.split('@')[0]}</b>
                <span className="tiny">{cloud.account.email}</span>
              </span>
              {cloud.account.plan?.name && (
                <span className="pill mini">{cloud.account.plan.name}</span>
              )}
            </button>
          )}

          {cloudEnabled && !cloud.account && (
            <button
              className="side-link"
              onClick={() => {
                onOpenAccount();
                onClose();
              }}
            >
              <Cloud size={17} />
              Hisobga kirish
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

          {/*
            * «Sozlamalar» bu yerdan olib tashlandi — u endi profil
            * ichida. Yon panel faqat ISHGA oid: suhbatlar, Code,
            * Agent, brauzer.
            */}
        </div>
      </aside>
    </>
  );
}
