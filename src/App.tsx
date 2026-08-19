import { useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { AgentView } from './components/AgentView';
import { ArtifactViewer } from './components/ArtifactView';
import { ChatView } from './components/ChatView';
import { CodeView } from './components/CodeView';
import { Cloud, Menu, Settings as SettingsIcon } from './components/Icons';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { VideoStudio } from './components/VideoStudio';
import { Browser } from './components/Browser';
import { AccountSheet } from './components/cloud/AccountSheet';
import { AdminPanel } from './components/cloud/AdminPanel';
import type { AgentSection } from './components/agent/sections';
import { TaskBar } from './components/TaskBar';
import { ToastHost } from './components/ui';
import { onOpenSite } from './lib/browserbus';
import { cloudEnabled, initCloud, useCloud } from './lib/cloud';
import { getModels, pickModel } from './lib/models';
import { installDeviceBridge } from './lib/devicebridge';
import { installSandboxStore } from './lib/sandbox';
import { getState, updateSettings, useStore } from './lib/store';
import type { Artifact } from './lib/types';

type Tab = 'chat' | 'agent' | 'kod';

/** Keng ekranmi — desktop koʻrinishi uchun (yon panel doim ochiq). */
function useWideScreen(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 960px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 960px)');
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
}

export default function App() {
  const theme = useStore((s) => s.settings.theme);
  const accent = useStore((s) => s.settings.accent);
  const fontScale = useStore((s) => s.settings.fontScale);
  const hasKey = useStore((s) => Boolean(s.settings.apiKey));
  const cloud = useCloud();
  const wide = useWideScreen();

  const [tab, setTab] = useState<Tab>('chat');
  const [section, setSection] = useState<AgentSection>('bugun');
  const [sidebar, setSidebar] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const greeted = useRef(false);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.fontSize = `${Math.round(16 * fontScale)}px`;
  }, [accent, fontScale]);

  // Qumboxdagi ilovalar saqlagan maʼlumotni qabul qilamiz.
  useEffect(() => installSandboxStore(), []);

  // Kamera, mikrofon va joylashuvni qumboxdagi ilovalarga uzatamiz.
  useEffect(() => installDeviceBridge(), []);

  // Havolalar ilovaning ichki brauzerida ochiladi.
  useEffect(() => onOpenSite((url) => setBrowserUrl(url)), []);

  // Bulut: sessiya, hisob va sinxronizatsiya.
  useEffect(() => initCloud(), []);

  // Na kalit, na obuna boʻlsa — bir marta sozlamalarni ochamiz.
  useEffect(() => {
    if (greeted.current || hasKey) return;
    if (cloudEnabled && (cloud.status === 'yuklanmoqda' || cloud.status === 'kirgan')) return;
    greeted.current = true;
    setSettingsOpen(true);
  }, [hasKey, cloud.status]);

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

  // Kalit yoki obuna bor bo'lsa — modellar ro'yxatini yangilab, eng yangisiga o'tamiz.
  const canQuery = hasKey || cloud.status === 'kirgan';
  useEffect(() => {
    if (!canQuery) return;
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
  }, [canQuery]);

  // Androidning "orqaga" tugmasi: avval ochiq oynalarni yopadi.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (artifact) setArtifact(null);
      else if (browserUrl !== null) setBrowserUrl(null);
      else if (videoId) setVideoId(null);
      else if (adminOpen) setAdminOpen(false);
      else if (accountOpen) setAccountOpen(false);
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
  }, [artifact, videoId, browserUrl, settingsOpen, accountOpen, adminOpen, sidebar, tab, section]);

  const showSidebar = wide || sidebar;

  return (
    <div className={wide ? 'shell wide' : 'shell'}>
      {showSidebar && (
        <Sidebar
          tab={tab}
          pinned={wide}
          activeSection={section}
          onClose={() => setSidebar(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAccount={() => setAccountOpen(true)}
          onOpenAdmin={() => setAdminOpen(true)}
          onOpenBrowser={() => setBrowserUrl('')}
          onGoChat={() => setTab('chat')}
          onGoCode={() => setTab('kod')}
          onGoAgent={(s) => {
            setTab('agent');
            setSection(s);
          }}
        />
      )}

      <div className="app">
        <header className="topbar">
          {!wide && (
            <button className="icon-btn" onClick={() => setSidebar(true)} aria-label="Menyu">
              <Menu />
            </button>
          )}

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

          {cloudEnabled && (
            <button
              className={cloud.status === 'kirgan' ? 'icon-btn on' : 'icon-btn'}
              onClick={() => setAccountOpen(true)}
              aria-label="Daho Cloud"
              title={cloud.account?.plan?.name ?? 'Daho Cloud'}
            >
              <Cloud size={19} />
            </button>
          )}

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

        <TaskBar />
      </div>

      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          onOpenAccount={() => {
            setSettingsOpen(false);
            setAccountOpen(true);
          }}
        />
      )}
      {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} />}
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
      {browserUrl !== null && (
        <Browser initialUrl={browserUrl} onClose={() => setBrowserUrl(null)} />
      )}
      {videoId && <VideoStudio projectId={videoId} onClose={() => setVideoId(null)} />}
      {artifact && <ArtifactViewer artifact={artifact} onClose={() => setArtifact(null)} />}

      <ToastHost />
    </div>
  );
}
