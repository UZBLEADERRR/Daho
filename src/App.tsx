import { useEffect, useState } from 'react';
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
import { AuthScreen } from './components/site/AuthScreen';
import { Landing } from './components/site/Landing';
import { SECTION_LABEL, isSection, type AgentSection } from './components/agent/sections';
import { TaskBar } from './components/TaskBar';
import { ToastHost, toast } from './components/ui';
import { startScheduler } from './lib/automation';
import { onOpenSite } from './lib/browserbus';
import { cloudEnabled, initCloud, useCloud } from './lib/cloud';
import { installDeviceBridge } from './lib/devicebridge';
import { finishConnect, listenDeepLink } from './lib/oauth';
import { onFallbackNotice } from './lib/route';
import { getModels, pickModel } from './lib/models';
import { allModels, cachedProviderModels } from './lib/providers';
import { installSandboxStore } from './lib/sandbox';
import { getState, updateSettings, updateView, useStore } from './lib/store';
import type { Artifact } from './lib/types';

type Tab = 'chat' | 'agent' | 'kod';

/** Keng ekranmi — desktop koʻrinishi uchun (yon panel doim ochiq). */
function useWideScreen(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
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
  // Ishlash uchun Gemini SHART emas — OpenRouter ham yetarli.
  const geminiKey = useStore((s) => Boolean(s.settings.apiKey));
  /**
   * Yoqilgan provayderlarning «imzosi»: id va kalit uzunligi. Kalit yozilib
   * yoki qoʻyib boʻlingach bu qiymat oʻzgaradi — shunda model roʻyxatini
   * oʻzi olib kelamiz. Kalitning oʻzi bogʻliqlikka tushmaydi.
   */
  const providerSig = useStore((s) =>
    (s.settings.providers ?? [])
      .filter((p) => p.enabled && p.apiKey.trim())
      .map((p) => `${p.id}:${p.apiKey.trim().length}`)
      .join('|'),
  );
  const cloud = useCloud();
  const wide = useWideScreen();
  const chats = useStore((st) => st.chats);
  const activeChatId = useStore((st) => st.activeChatId);
  const ready = geminiKey || Boolean(providerSig) || cloud.status === 'kirgan';

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
  const [accountOpen, setAccountOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'kirish' | 'royxat' | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    // Suhbat matni shu oʻzgaruvchi orqali kattalashadi (px emas, sozlanadigan).
    document.documentElement.style.setProperty('--chat-font', `${(15 * fontScale).toFixed(1)}px`);
    document.documentElement.style.fontSize = `${Math.round(16 * fontScale)}px`;
  }, [accent, fontScale]);

  // Qumboxdagi ilovalar saqlagan maʼlumotni qabul qilamiz.
  useEffect(() => installSandboxStore(), []);

  // Limit tugab zaxira modelga oʻtilsa — foydalanuvchiga aytamiz.
  useEffect(() => onFallbackNotice((text) => toast(text)), []);

  /*
   * Xizmatga ulanishdan qaytish. Vebda manzilda `?code=` boʻladi,
   * telefonda esa deep link keladi — ikkalasi ham shu yerda yakunlanadi.
   */
  useEffect(() => {
    void finishConnect()
      .then((provider) => {
        if (provider) toast(`${provider} ulandi`);
      })
      .catch((err) => toast(String((err as Error)?.message ?? err)));
    listenDeepLink((provider) => toast(`${provider} ulandi`));
  }, []);

  // Avtomatlashtirilgan topshiriqlar soati.
  useEffect(() => startScheduler(), []);

  // Kamera, mikrofon va joylashuvni qumboxdagi ilovalarga uzatamiz.
  useEffect(() => installDeviceBridge(), []);

  // Havolalar ilovaning ichki brauzerida ochiladi.
  useEffect(() => onOpenSite((url) => setBrowserUrl(url)), []);

  // Bulut: sessiya, hisob va sinxronizatsiya.
  useEffect(() => initCloud(), []);

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
   * Provayder kaliti kiritilgach model roʻyxatini OʻZI olib keladi —
   * foydalanuvchi model nomlarini qoʻlda yozishi shart emas.
   *
   * Kalit yozilayotganda har harfda soʻrov yubormaslik uchun 1.2 s kutamiz.
   * Gemini kaliti yoʻq boʻlsa, roʻyxat kelgach asosiy modelni ham oʻsha
   * provayderning modeliga almashtiramiz (aks holda standart Gemini modeli
   * qolib, birinchi savolda «kalit yoʻq» xatosi chiqadi).
   */
  useEffect(() => {
    if (!providerSig) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const list = await allModels(true);
          if (cancelled || !list.length) return;

          const { settings } = getState();
          if (settings.apiKey.trim()) return; // Gemini bor — model almashtirmaymiz
          if (settings.model.includes('::')) return; // allaqachon provayder modeli

          const hidden = new Set(settings.hiddenModels ?? []);
          // Faqat haqiqiy roʻyxat kelgan provayderdan tanlaymiz.
          const usable = list.filter(
            (m) =>
              m.role === 'chat' &&
              m.provider &&
              !hidden.has(m.id) &&
              cachedProviderModels(m.provider).length > 0,
          );
          if (usable.length) updateSettings({ model: usable[0].id });
        } catch {
          /* roʻyxat olinmasa tavsiya modellar qoladi, foydalanuvchi oʻzi tanlaydi */
        }
      })();
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [providerSig]);

  // Androidning "orqaga" tugmasi: avval ochiq oynalarni yopadi.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('backButton', ({ canGoBack }) => {
      const view = getState().view;
      if (artifact) setArtifact(null);
      else if (browserUrl !== null) setBrowserUrl(null);
      else if (videoId) setVideoId(null);
      else if (adminOpen) setAdminOpen(false);
      else if (accountOpen) setAccountOpen(false);
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
  }, [artifact, videoId, browserUrl, settingsOpen, accountOpen, adminOpen, sidebar, tab, section]);

  const showSidebar = wide || sidebar;

  /**
   * Kirish darvozasi.
   *
   * Faqat bulut yoqilgan (build vaqtida manzil berilgan) va foydalanuvchi
   * kirmagan holatda koʻrsatiladi. Bulutsiz yigʻilgan nusxa avvalgidek —
   * toʻgʻridan-toʻgʻri ilovaga kiraveradi, oʻz kaliti bilan ishlaydi.
   *
   * Vebda avval rasmiy bosh sahifa, telefonda esa darhol kirish oynasi:
   * ilovani ataylab oʻrnatgan odamga reklama sahifasi ortiqcha.
   */
  if (cloudEnabled && cloud.status === 'kirilmagan') {
    const native = Capacitor.isNativePlatform();
    // Server bilan muammo boʻlsa reklama sahifasi emas, sababi koʻrsatilsin.
    if (native || authMode || cloud.error) {
      return (
        <AuthScreen
          initial={authMode ?? 'kirish'}
          serverError={cloud.error}
          onBack={native || cloud.error ? undefined : () => setAuthMode(null)}
        />
      );
    }
    return <Landing onStart={setAuthMode} />;
  }

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
          onGoAgent={(sec) => {
            setTab('agent');
            setSection(sec);
          }}
        />
      )}

      <div className="app">
      <header className="topbar">
        {!wide ? (
          <button className="icon-btn" onClick={() => setSidebar(true)} aria-label="Menyu">
            <Menu />
          </button>
        ) : (
          <div className="topbar-title">
            {tab === 'chat'
              ? (chats.find((c) => c.id === activeChatId)?.title ?? 'Yangi suhbat')
              : tab === 'agent'
                ? SECTION_LABEL[section]
                : 'Daho Code'}
          </div>
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

        <div className="topbar-right">
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
        </div>
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
      {accountOpen && (
        <AccountSheet
          onClose={() => setAccountOpen(false)}
          onOpenAdmin={() => {
            setAccountOpen(false);
            setAdminOpen(true);
          }}
        />
      )}
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
