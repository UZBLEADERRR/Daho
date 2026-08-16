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
import type { AgentSection } from './components/agent/sections';
import { ToastHost } from './components/ui';
import { getModels, pickModel } from './lib/models';
import { getState, updateSettings, useStore } from './lib/store';
import type { Artifact } from './lib/types';

type Tab = 'chat' | 'agent' | 'kod';

export default function App() {
  const theme = useStore((s) => s.settings.theme);
  const hasKey = useStore((s) => Boolean(s.settings.apiKey));
  const [tab, setTab] = useState<Tab>('chat');
  const [section, setSection] = useState<AgentSection>('bugun');
  const [sidebar, setSidebar] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(!hasKey);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

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
    if (!hasKey) return;
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
  }, [hasKey]);

  // Androidning "orqaga" tugmasi: avval ochiq oynalarni yopadi.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (artifact) setArtifact(null);
      else if (videoId) setVideoId(null);
      else if (settingsOpen) setSettingsOpen(false);
      else if (sidebar) setSidebar(false);
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
