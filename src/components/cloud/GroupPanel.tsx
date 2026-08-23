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
  myGroups,
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
import { Sheet, toast } from '../ui';

type Tab = 'azolar' | 'suhbat' | 'kredit';

/* ---------------------------------------------------------------- taklif */

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
      await respondInvite(id, ha);
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

  return (
    <div>
      <div className="grp-feed">
        {!rows.length && <div className="tiny">Hali xabar yoʻq.</div>}
        {rows.map((m) => (
          <div
            className={m.user_id === account?.user_id ? 'grp-msg mine' : 'grp-msg'}
            key={m.id}
          >
            <div className="grp-who">{m.name}</div>
            <div>{m.body}</div>
            <div className="grp-time">
              {new Date(m.created_at).toLocaleTimeString('uz-UZ', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input
          className="grow"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          placeholder="Xabar yozing"
        />
        <button className="btn mini" onClick={() => void send()}>
          Yuborish
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

export function GroupPanel({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('azolar');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    void myGroups()
      .then(setGroups)
      .catch((err) => toast(String((err as Error)?.message ?? err)));
  };
  useEffect(load, []);

  const group = groups.find((g) => g.id === openId) ?? null;

  // Ochiq guruh — soʻrovlar shu hisobdan toʻlansin.
  useEffect(() => {
    setActiveGroup(group?.id ?? null);
    return () => setActiveGroup(null);
  }, [group?.id]);

  const och = async () => {
    if (name.trim().length < 2) {
      toast('Guruh nomini yozing');
      return;
    }
    setBusy(true);
    try {
      const g = await createGroup(name.trim());
      setName('');
      load();
      setOpenId(g.id);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  if (group) {
    return (
      <Sheet title={group.name} onClose={() => setOpenId(null)}>
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

        {tab === 'azolar' && (
          <Members
            group={group}
            onChanged={() => {
              load();
              setOpenId(null);
            }}
          />
        )}
        {tab === 'suhbat' && <Chat group={group} />}
        {tab === 'kredit' && <Wallet group={group} onChanged={load} />}
      </Sheet>
    );
  }

  return (
    <Sheet title="Guruhlar" onClose={onClose}>
      <InviteList onJoined={load} />

      <div className="section-label">Guruhlarim</div>
      {!groups.length && (
        <div className="tiny">
          Hali guruh yoʻq. Nom yozib guruh oching, soʻng odam qidirib chaqiring.
        </div>
      )}
      {groups.map((g) => (
        <button className="cloud-card as-row" key={g.id} onClick={() => setOpenId(g.id)}>
          <div className="between">
            <div>
              <b>{g.name}</b>
              <div className="tiny">
                {g.members} aʼzo · {formatCredits(g.credits)} kredit
                {g.my_role === 'owner' ? ' · egasi sizsiz' : ` · egasi: ${g.owner_name}`}
              </div>
            </div>
            <span className="prof-chevron">›</span>
          </div>
        </button>
      ))}

      <div className="section-label">Yangi guruh</div>
      <div className="row">
        <input
          className="grow"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Guruh nomi"
        />
        <button className="btn mini" disabled={busy} onClick={() => void och()}>
          Ochish
        </button>
      </div>
    </Sheet>
  );
}
