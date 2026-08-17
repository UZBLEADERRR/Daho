import { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { AgentView } from './components/AgentView';
import { ArtifactViewer } from './components/ArtifactView';
import { ChatView } from './components/ChatView';
import { CodeView } from './components/CodeView';
import { Menu, Settings as SettingsIcon } from './components/Icons';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { VideoStudio } from './components/VideoStudio';
import { isSection, type AgentSection } from './components/agent/sections';
import { TaskBar } from './components/TaskBar';
import { ToastHost } from './components/ui';
import { startScheduler } from './lib/automation';
import { getModels, pickModel } from './lib/models';
import { allModels } from './lib/providers';
import { installSandboxStore } from './lib/sandbox';
import { getState, updateSettings, updateView, useStore } from './lib/store';
import type { Artifact } from './lib/types';

type Tab = 'chat' | 'agent' | 'kod';

export default function App() {
  const theme = useStore((s) => s.settings.theme);
  const accent = useStore((s) => s.settings.accent);
  const fontScale = useStore((s) => s.settings.fontScale);
  // Ishlash uchun Gemini SHART emas — OpenRouter ham yetarli.
  const geminiKey = useStore((s) => Boolean(s.settings.apiKey));
  const providerCount = useStore((s) => (s.settings.providers ?? []).filter((p) => p.enabled && p.apiKey).length);
  const ready = geminiKey || providerCount > 0;

  // Qaysi ekran ochiqligi store da turadi: boʻlim almashsangiz ham,
  // ilovani yopib qayta ochsangiz ham hech narsa qaytadan boshlanmaydi.
  const tab = useStore((s) => s.view.tab) as Tab;
  const rawSection = useStore((s) => s.view.section);
  const section: AgentSection = isSection(rawSection) ? rawSection : 'bugun';
  const setTab = (next: Tab) => updateView({ tab: next });
  const setSection = (next: AgentSection) => updateView({ section: next });

  const [sidebar, setSidebar] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(!ready);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.fontSize = `${Math.round(16 * fontScale)}px`;
  }, [accent, fontScale]);

  // Qumboxdagi ilovalar saqlagan maʼlumotni qabul qilamiz.
  useEffect(() => installSandboxStore(), []);

  // Avtomatlashtirilgan topshiriqlar soati.
  useEffect(() => startScheduler(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const bg = theme === 'tun' ? '#09090b' : '#fbfbfc';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: theme === 'tun' ? Style.Dark : Style.Light }).catch(
        () => undefined,
      );
      StatusBar.setBackgroundColor({ color: bg }).catch(() => undefined);
    }
  }, [theme]);

  // Kalit bor bo'lsa — modellar ro'yxatini yangilab, eng yangisiga o'tamiz.
  useEffect(() => {
    if (!geminiKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await getModels(getState().settings.apiKey);
        if (cancelled || !list.length) return;
        const { settings } = getState();
        updateSettings({
          model: pickModel(list, 'chat', settings.model) ?? settings.model,
          imageModel: pickModel(list, 'image', settings.imageModel) ?? settings.imageModel,
          ttsModel: pickModel(list, 'tts', settings.ttsModel) ?? settings.ttsModel,
        });
      } catch {
        /* offline bo'lsa keshdagi qiymatlar qoladi */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geminiKey]);

  /**
   * Gemini kaliti yoʻq, lekin provayder (masalan OpenRouter) ulangan boʻlsa —
   * modellarni oʻsha provayderdan olib, asosiy modelni almashtiramiz.
   * Aks holda standart Gemini modeli qolib, «kalit yoʻq» xatosi chiqadi.
   */
  useEffect(() => {
    if (geminiKey || !providerCount) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await allModels(true);
        if (cancelled) return;
        const { settings } = getState();
        const hidden = new Set(settings.hiddenModels ?? []);
        const usable = list.filter((m) => m.role === 'chat' && m.provider && !hidden.has(m.id));
        if (!usable.length) return;
        // Joriy model Gemini niki boʻlsa (yaʼni ishlamaydi) — almashtiramiz.
        if (!settings.model.includes('::')) {
          updateSettings({ model: usable[0].id });
        }
      } catch {
        /* roʻyxat olinmasa foydalanuvchi oʻzi tanlaydi */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geminiKey, providerCount]);

  // Androidning "orqaga" tugmasi: avval ochiq oynalarni yopadi.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('backButton', ({ canGoBack }) => {
      const view = getState().view;
      if (artifact) setArtifact(null);
      else if (videoId) setVideoId(null);
      else if (settingsOpen) setSettingsOpen(false);
      else if (sidebar) setSidebar(false);
      // Ochiq kitob/kurs/loyiha — avval oʻshani yopamiz.
      else if (tab === 'agent' && view.bookId) updateView({ bookId: null });
      else if (tab === 'agent' && view.courseId) updateView({ courseId: null });
      else if (tab === 'kod' && view.codeId) updateView({ codeId: null });
      else if (tab === 'agent' && section !== 'bugun') setSection('bugun');
      else if (tab !== 'chat') setTab('chat');
      else if (canGoBack) window.history.back();
      else CapApp.exitApp();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [artifact, videoId, settingsOpen, sidebar, tab, section]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setSidebar(true)} aria-label="Menyu">
          <Menu />
        </button>

        <div className="tabs">
          <button className={tab === 'chat' ? 'tab on' : 'tab'} onClick={() => setTab('chat')}>
            Chat
          </button>
          <button className={tab === 'agent' ? 'tab on' : 'tab'} onClick={() => setTab('agent')}>
            Agent
          </button>
          <button className={tab === 'kod' ? 'tab on' : 'tab'} onClick={() => setTab('kod')}>
            Code
          </button>
        </div>

        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Sozlamalar"
        >
          <SettingsIcon size={20} />
        </button>
      </header>

      <TaskBar />

      <main className="main">
        {tab === 'chat' && (
          <ChatView onOpenArtifact={setArtifact} onOpenVideo={setVideoId} />
        )}
        {tab === 'agent' && (
          <AgentView
            section={section}
            onSection={setSection}
            onOpenArtifact={setArtifact}
            onOpenVideo={setVideoId}
          />
        )}
        {tab === 'kod' && <CodeView />}
      </main>

      {sidebar && (
        <Sidebar
          tab={tab}
          activeSection={section}
          onClose={() => setSidebar(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onGoChat={() => setTab('chat')}
          onGoCode={() => setTab('kod')}
          onGoAgent={(s) => {
            setTab('agent');
            setSection(s);
          }}
        />
      )}

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {videoId && <VideoStudio projectId={videoId} onClose={() => setVideoId(null)} />}
      {artifact && <ArtifactViewer artifact={artifact} onClose={() => setArtifact(null)} />}

      <ToastHost />
    </div>
  );
}
