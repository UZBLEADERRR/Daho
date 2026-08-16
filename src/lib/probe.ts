/**
 * Ilovani sinovdan oʻtkazish.
 *
 * Agent yozgan HTML loyihani koʻrinmas iframe ichida haqiqatan ishga tushiramiz,
 * JavaScript xatolarini ushlaymiz va sahifaning matnli "surati"ni olamiz —
 * sarlavha, tugmalar, maydonlar, koʻrinib turgan matn. Shu maʼlumot modelga
 * qaytariladi: u oʻz ishini koʻrib, xatosini oʻzi tuzatadi.
 */

import { sandboxDocument } from './sandbox';

export interface ProbeResult {
  /** Ishga tushdimi (kamida bir narsa chizildimi) */
  ok: boolean;
  title: string;
  /** JS xatolari — eng muhimi shu */
  errors: string[];
  /** Konsoldagi ogohlantirishlar */
  warnings: string[];
  /** Sahifada koʻringan sarlavhalar */
  headings: string[];
  /** Bosiladigan elementlar */
  buttons: string[];
  /** Kiritish maydonlari */
  inputs: string[];
  /** Sahifadagi matnning boshlanishi */
  text: string;
  /** Chizilgan elementlar soni */
  nodes: number;
}

const HARNESS = `<script>(function(){
  var errors=[],warns=[];
  function say(m){ if(errors.length<12) errors.push(String(m).slice(0,300)); }
  window.onerror=function(m,s,l,c){ say(m+(l?' ('+l+':'+c+')':'')); };
  window.addEventListener('unhandledrejection',function(e){
    say('Promise: '+((e.reason&&(e.reason.message||e.reason))||'nomaʼlum'));
  });
  var ce=console.error,cw=console.warn;
  console.error=function(){ say(Array.prototype.join.call(arguments,' ')); ce.apply(console,arguments); };
  console.warn=function(){ if(warns.length<8) warns.push(Array.prototype.join.call(arguments,' ').slice(0,200)); cw.apply(console,arguments); };

  function txt(el){ return (el.textContent||el.value||el.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim().slice(0,60); }
  function pick(sel,limit){
    var out=[],list=document.querySelectorAll(sel);
    for(var i=0;i<list.length&&out.length<limit;i++){
      var t=txt(list[i]);
      if(t) out.push(t);
    }
    return out;
  }
  function report(){
    var body=document.body;
    var data={
      title:(document.title||'').slice(0,80),
      errors:errors,
      warnings:warns,
      headings:pick('h1,h2,h3',10),
      buttons:pick('button,[role=button],a.btn,input[type=button],input[type=submit]',14),
      inputs:(function(){
        var out=[],list=document.querySelectorAll('input,select,textarea');
        for(var i=0;i<list.length&&out.length<12;i++){
          var el=list[i];
          out.push((el.getAttribute('placeholder')||el.getAttribute('name')||el.getAttribute('aria-label')||el.type||el.tagName).slice(0,40));
        }
        return out;
      })(),
      text:body?(body.innerText||body.textContent||'').replace(/\\s+/g,' ').trim().slice(0,600):'',
      nodes:body?body.querySelectorAll('*').length:0
    };
    try{ parent.postMessage({__daho:'probe',id:__PROBE_ID__,data:data},'*'); }catch(e){}
  }
  // Ilova DOM ni kech chizishi mumkin — biroz kutamiz.
  setTimeout(report,__PROBE_WAIT__);
})();</script>`;

let counter = 0;

/** HTML hujjatni yashirin iframe da ishga tushirib, natijani qaytaradi. */
export function probeApp(html: string, waitMs = 1200): Promise<ProbeResult> {
  const id = `probe_${(counter += 1)}`;
  const harness = HARNESS.replace('__PROBE_ID__', JSON.stringify(id)).replace(
    '__PROBE_WAIT__',
    String(Math.max(200, Math.min(6000, waitMs))),
  );

  // Saqlash qatlami + sinov qatlami: ikkalasi ham <head> ga tushadi.
  const doc = sandboxDocument(html, id).replace(/<\/head>/i, `${harness}</head>`);

  return new Promise<ProbeResult>((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:412px;height:800px;border:0;visibility:hidden';

    let done = false;
    const finish = (result: ProbeResult) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      frame.remove();
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      const payload = event.data as
        | { __daho?: string; id?: string; data?: Partial<ProbeResult> }
        | null;
      if (!payload || payload.__daho !== 'probe' || payload.id !== id) return;
      const d = payload.data ?? {};
      finish({
        ok: (d.nodes ?? 0) > 2 && !(d.errors ?? []).length,
        title: d.title ?? '',
        errors: d.errors ?? [],
        warnings: d.warnings ?? [],
        headings: d.headings ?? [],
        buttons: d.buttons ?? [],
        inputs: d.inputs ?? [],
        text: d.text ?? '',
        nodes: d.nodes ?? 0,
      });
    };

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          title: '',
          errors: ['Sahifa ishga tushmadi — hisobot kelmadi (sintaksis xatosi boʻlishi mumkin).'],
          warnings: [],
          headings: [],
          buttons: [],
          inputs: [],
          text: '',
          nodes: 0,
        }),
      waitMs + 4000,
    );

    window.addEventListener('message', onMessage);
    frame.srcdoc = doc;
    document.body.appendChild(frame);
  });
}

/** Natijani model oʻqiy oladigan qisqa matnga aylantiradi. */
export function describeProbe(r: ProbeResult): string {
  const lines: string[] = [];
  lines.push(r.ok ? '✅ Ilova ishga tushdi.' : '❌ Muammo bor.');
  if (r.title) lines.push(`Sarlavha: ${r.title}`);
  lines.push(`Chizilgan elementlar: ${r.nodes}`);
  if (r.errors.length) lines.push(`XATOLAR:\n- ${r.errors.join('\n- ')}`);
  if (r.warnings.length) lines.push(`Ogohlantirish: ${r.warnings.join(' | ')}`);
  if (r.headings.length) lines.push(`Sarlavhalar: ${r.headings.join(' · ')}`);
  if (r.buttons.length) lines.push(`Tugmalar: ${r.buttons.join(' · ')}`);
  if (r.inputs.length) lines.push(`Maydonlar: ${r.inputs.join(' · ')}`);
  if (r.text) lines.push(`Ekrandagi matn: ${r.text}`);
  if (!r.nodes) lines.push('Sahifa boʻsh chiqdi — HTML yoki JS ishlamayapti.');
  return lines.join('\n');
}
