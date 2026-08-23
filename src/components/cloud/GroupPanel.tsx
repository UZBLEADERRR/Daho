/**
 * Guruh paneli — aʼzolar, suhbat va hamyon.
 *
 * Loyihada birga ishlash uchun kerak boʻlgan hamma narsa bitta joyda:
 * kimni chaqirish, kim bor, nima deyilgan va kredit qanchaligi.
 */
import { useEffect, useRef, useState } from 'react';
import { formatCredits, useCloud } from '../../lib/cloud';
import {
  createGroup,
  findPeople,
  groupFeed,
  groupPeople,
  invitePerson,
  leaveGroup,
  moveCreditsToGroup,
  groupById,
  groupForProject,
  loadGroupProject,
  myInvites,
  postGroupMessage,
  respondInvite,
  type GroupInvite,
  type GroupMember,
  type GroupMessage,
  type GroupRow,
  type Person,
} from '../../lib/cloud/groups';
import { setActiveGroup } from '../../lib/cloud/groupctx';
import { createCodeProject, getCodeProject, patchCodeProject } from '../../lib/codeproject';
import { getState } from '../../lib/store';
import type { CodeProject } from '../../lib/types';
import { toast } from '../ui';

type Tab = 'azolar' | 'suhbat' | 'kredit';

/* ---------------------------------------------------------------- taklif */

/**
 * Taklif qabul qilingach umumiy loyihani oʻzimizga olib qoʻyamiz.
 *
 * Aks holda odam guruhga qoʻshilardi-yu, loyihaning oʻzi unda
 * koʻrinmasdi — «birga ishlash» degani shundan boshlanadi.
 * Loyiha allaqachon bogʻlangan boʻlsa qaytadan yaratilmaydi.
 */
async function loyihaniOl(groupId: string, groupName: string): Promise<void> {
  const bor = getState().code.find((p: CodeProject) => p.groupId === groupId);
  if (bor) return;

  const umumiy = await loadGroupProject(groupId).catch(() => null);
  const manba = (umumiy?.project ?? {}) as Partial<CodeProject>;

  const loyiha = createCodeProject(manba.name || groupName, manba.template || 'statik');
  patchCodeProject(loyiha.id, {
    groupId,
    // Egasi allaqachon fayl yozgan boʻlsa — oʻshani olamiz.
    ...(Array.isArray(manba.files) && manba.files.length ? { files: manba.files } : {}),
    ...(manba.description ? { description: manba.description } : {}),
    ...(manba.spec ? { spec: manba.spec } : {}),
  });
  // Yaratilgani darhol ochilsin deb emas: odam oʻzi kirganda koʻradi.
  void getCodeProject(loyiha.id);
}

/** Menga kelgan takliflar — profil va guruh panelida koʻrinadi. */
export function InviteList({ onJoined }: { onJoined?: () => void }) {
  const [rows, setRows] = useState<GroupInvite[]>([]);

  const load = () => {
    void myInvites()
      .then(setRows)
      .catch(() => setRows([]));
  };
  useEffect(load, []);

  if (!rows.length) return null;

  const javob = async (id: string, ha: boolean) => {
    try {
      const row = rows.find((r) => r.id === id);
      await respondInvite(id, ha);
      if (ha && row) await loyihaniOl(row.group_id, row.group_name);
      toast(ha ? 'Guruhga qoʻshildingiz' : 'Taklif rad etildi');
      load();
      if (ha) onJoined?.();
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    }
  };

  return (
    <>
      <div className="section-label">Takliflar</div>
      {rows.map((i) => (
        <div className="cloud-card" key={i.id}>
          <b>{i.group_name}</b>
          <div className="tiny">{i.from_name} chaqirdi</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn mini grow" onClick={() => void javob(i.id, true)}>
              Qoʻshilaman
            </button>
            <button className="btn ghost mini grow" onClick={() => void javob(i.id, false)}>
              Rad etaman
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- aʼzolar */

function Members({ group, onChanged }: { group: GroupRow; onChanged: () => void }) {
  const { account } = useCloud();
  const [people, setPeople] = useState<GroupMember[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);

  const load = () => {
    void groupPeople(group.id)
      .then(setPeople)
      .catch(() => setPeople([]));
  };
  useEffect(load, [group.id]);

  /*
   * Qidiruv har harfda emas, 400 ms jimlikdan keyin. Aks holda har bir
   * bosilgan tugma uchun bazaga soʻrov ketardi.
   */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setFound([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void findPeople(q)
        .then(setFound)
        .catch(() => setFound([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => {
      clearTimeout(timer);
      setSearching(false);
    };
  }, [query]);

  const chaqir = async (p: Person) => {
    try {
      await invitePerson(group.id, p.user_id);
      toast(`${p.name} ga taklif yuborildi`);
      setQuery('');
      setFound([]);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    }
  };

  return (
    <div>
      <div className="field">
        <label>Odam qidirish</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ism yoki toʻliq pochta"
        />
      </div>
      <div className="tiny" style={{ marginTop: -6, marginBottom: 10, opacity: 0.75 }}>
        Roʻyxat ochiq emas: ismning kamida 3 harfi yoki toʻliq pochta kerak.
      </div>

      {searching && <div className="tiny">Qidirilmoqda…</div>}
      {found.map((p) => (
        <div className="cloud-card" key={p.user_id}>
          <div className="between">
            <div>
              <b>{p.name}</b>
              <div className="tiny">{p.email_hint}</div>
            </div>
            <button className="btn mini" onClick={() => void chaqir(p)}>
              Chaqirish
            </button>
          </div>
        </div>
      ))}
      {query.trim().length >= 3 && !searching && !found.length && (
        <div className="tiny">Topilmadi.</div>
      )}

      <div className="section-label">Guruhda ({people.length})</div>
      {people.map((m) => (
        <div className="cloud-card" key={m.user_id}>
          <div className="between">
            <div>
              <b>{m.name}</b>
              <div className="tiny">{m.role === 'owner' ? 'egasi' : 'aʼzo'}</div>
            </div>
            {m.user_id === account?.user_id && m.role !== 'owner' && (
              <button
                className="btn ghost mini"
                onClick={async () => {
                  try {
                    await leaveGroup(group.id, m.user_id);
                    toast('Guruhdan chiqdingiz');
                    onChanged();
                  } catch (err) {
                    toast(String((err as Error)?.message ?? err));
                  }
                }}
              >
                Chiqish
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- suhbat */

function Chat({ group }: { group: GroupRow }) {
  const { account } = useCloud();
  const [rows, setRows] = useState<GroupMessage[]>([]);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const load = () => {
    void groupFeed(group.id)
      .then(setRows)
      .catch(() => setRows([]));
  };

  /*
   * 6 soniyada bir yangilanadi. Realtime ulanish ochish mumkin edi,
   * lekin 1000 foydalanuvchida ochiq soket qimmat — bu yerda esa
   * xabar kamdan-kam keladi.
   */
  useEffect(() => {
    load();
    const timer = setInterval(load, 6000);
    return () => clearInterval(timer);
  }, [group.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [rows.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      await postGroupMessage(group.id, body);
      load();
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
      setText(body);
    }
  };

  /*
   * Kun ajratgichi va «ketma-ket xabar» qoidasi — messenjerlardagidek.
   * Bir odam ketma-ket yozsa ismi va avatari qayta chizilmaydi:
   * shunda oqim tiqilib qolmaydi.
   */
  const kun = (iso: string) => new Date(iso).toDateString();
  const kunNomi = (iso: string) => {
    const d = new Date(iso);
    const bugun = new Date();
    const kecha = new Date(bugun.getTime() - 86400000);
    if (d.toDateString() === bugun.toDateString()) return 'Bugun';
    if (d.toDateString() === kecha.toDateString()) return 'Kecha';
    return d.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long' });
  };

  return (
    <div className="chatbox">
      <div className="chatbox-feed">
        {!rows.length && (
          <div className="chatbox-empty">
            Hali xabar yoʻq. Birinchi boʻlib yozing.
          </div>
        )}

        {rows.map((m, i) => {
          const men = m.user_id === account?.user_id;
          const oldingi = rows[i - 1];
          const yangiKun = !oldingi || kun(oldingi.created_at) !== kun(m.created_at);
          // Ketma-ket: bir odam, 5 daqiqa ichida.
          const ketma =
            !yangiKun &&
            oldingi?.user_id === m.user_id &&
            new Date(m.created_at).getTime() - new Date(oldingi.created_at).getTime() < 300000;

          return (
            <div key={m.id}>
              {yangiKun && <div className="chat-day">{kunNomi(m.created_at)}</div>}
              <div className={`chat-line${men ? ' mine' : ''}${ketma ? ' cont' : ''}`}>
                {!men && (
                  <span className="chat-ava">
                    {ketma ? '' : (m.name || '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="chat-bubble">
                  {!men && !ketma && <div className="chat-name">{m.name}</div>}
                  <span className="chat-text">{m.body}</span>
                  <span className="chat-clock">
                    {new Date(m.created_at).toLocaleTimeString('uz-UZ', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="chatbox-bar">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Xabar…"
        />
        <button
          className="chatbox-send"
          onClick={() => void send()}
          disabled={!text.trim()}
          aria-label="Yuborish"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hamyon */

function Wallet({ group, onChanged }: { group: GroupRow; onChanged: () => void }) {
  const { account } = useCloud();
  const [amount, setAmount] = useState(1000);
  const [busy, setBusy] = useState(false);

  const otkaz = async () => {
    setBusy(true);
    try {
      const left = await moveCreditsToGroup(group.id, amount);
      toast(`Guruh hamyoni: ${formatCredits(left)} kredit`);
      onChanged();
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="cloud-card">
        <div className="between">
          <div>
            <b>{formatCredits(group.credits)}</b>
            <div className="tiny">guruh hamyonida</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <b>{formatCredits(account?.balance ?? 0)}</b>
            <div className="tiny">sizda</div>
          </div>
        </div>
      </div>

      <div className="tiny" style={{ margin: '12px 0' }}>
        Guruh ichidagi soʻrov avval <b>guruh hamyonidan</b> toʻlanadi — shunda
        krediti tugagan aʼzo ham ishlay oladi. Guruhda yetmasa odamning oʻz
        krediti ishlatiladi.
      </div>

      <div className="field">
        <label>Guruhga oʻtkazish</label>
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
        />
      </div>
      <button className="btn wide" disabled={busy} onClick={() => void otkaz()}>
        {busy ? 'Oʻtkazilmoqda…' : `${formatCredits(amount)} kredit oʻtkazish`}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- asosiy */

/**
 * Loyihaning guruhi.
 *
 * Guruh mustaqil roʻyxat emas — u HAR BIR LOYIHA uchun alohida.
 * Shuning uchun bu yerda tanlash yoʻq: ochiq loyihaning guruhi
 * koʻrsatiladi, boʻlmasa bitta tugma bilan ochiladi.
 */
export function ProjectGroup({
  projectId,
  projectName,
  groupId,
  onLinked,
}: {
  projectId: string;
  projectName: string;
  /** Loyihada saqlangan guruh (aʼzo uchun — taklif orqali kelgan). */
  groupId?: string;
  /** Guruh ochilganda loyihaga yozib qoʻyish uchun. */
  onLinked: (id: string) => void;
}) {
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [holat, setHolat] = useState<'yuklanmoqda' | 'yoʻq' | 'bor'>('yuklanmoqda');
  const [tab, setTab] = useState<Tab>('azolar');
  const [busy, setBusy] = useState(false);

  const load = () => {
    const soʻrov = groupId ? groupById(groupId) : groupForProject(projectId);
    void soʻrov
      .then((g) => {
        setGroup(g);
        setHolat(g ? 'bor' : 'yoʻq');
        if (g && !groupId) onLinked(g.id);
      })
      .catch((err) => {
        setHolat('yoʻq');
        toast(String((err as Error)?.message ?? err));
      });
  };

  useEffect(load, [projectId, groupId]);

  /*
   * Ochiq guruh — shu loyihadagi soʻrovlar guruh hisobidan toʻlansin.
   * Boʻlim yopilganda kontekst tozalanadi.
   */
  useEffect(() => {
    setActiveGroup(group?.id ?? null);
    return () => setActiveGroup(null);
  }, [group?.id]);

  const och = async () => {
    setBusy(true);
    try {
      const g = await createGroup(projectName || 'Loyiha', 'kod', projectId);
      onLinked(g.id);
      setGroup(g);
      setHolat('bor');
      toast('Guruh ochildi — endi odam chaqiring');
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  if (holat === 'yuklanmoqda') {
    return (
      <div className="scroll">
        <div className="pad">
          <div className="tiny">Yuklanmoqda…</div>
        </div>
      </div>
    );
  }

  if (holat === 'yoʻq' || !group) {
    return (
      <div className="scroll">
        <div className="pad">
          <InviteList onJoined={load} />

          <div className="cloud-card">
            <b>Bu loyihada yolgʻiz ishlayapsiz</b>
            <div className="tiny" style={{ marginTop: 4 }}>
              Guruh ochsangiz boshqalarni chaqira olasiz: loyiha ham, suhbat
              ham umumiy boʻladi. Guruh hamyoniga kredit qoʻysangiz, krediti
              tugagan aʼzo ham ishlay oladi.
            </div>
            <button
              className="btn wide"
              style={{ marginTop: 10 }}
              disabled={busy}
              onClick={() => void och()}
            >
              {busy ? 'Ochilmoqda…' : 'Shu loyiha uchun guruh ochish'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scroll">
      <div className="pad">
        <div className="between" style={{ marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <b>{group.name}</b>
            <div className="tiny">
              {group.members} aʼzo · {formatCredits(group.credits)} kredit
              {group.my_role === 'owner' ? ' · egasi sizsiz' : ` · egasi: ${group.owner_name}`}
            </div>
          </div>
        </div>

        <div className="seg">
          <button className={tab === 'azolar' ? 'on' : ''} onClick={() => setTab('azolar')}>
            Aʼzolar
          </button>
          <button className={tab === 'suhbat' ? 'on' : ''} onClick={() => setTab('suhbat')}>
            Suhbat
          </button>
          <button className={tab === 'kredit' ? 'on' : ''} onClick={() => setTab('kredit')}>
            Kredit
          </button>
        </div>

        {tab === 'azolar' && <Members group={group} onChanged={load} />}
        {tab === 'suhbat' && <Chat group={group} />}
        {tab === 'kredit' && <Wallet group={group} onChanged={load} />}
      </div>
    </div>
  );
}
