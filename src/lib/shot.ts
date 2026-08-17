/**
 * Skrinshot — agent oʻz ishini KOʻRADI.
 *
 * Sinov (probe) sahifadan matnli hisobot oladi: qanday tugmalar bor, xato
 * chiqdimi. Lekin «dizayn buzuq» degan narsani matndan bilib boʻlmaydi.
 * Shuning uchun sahifani haqiqatan rasmga olamiz va rasmni modelga
 * koʻrsatamiz — u oʻz ishini koʻrib, oʻzi tuzatadi.
 *
 * Brauzerda `html2canvas` kabi kutubxona ishlatmaymiz (tashqi bogʻliqlik
 * kerak emas): sahifa ichida SVG `<foreignObject>` ga koʻchiriladi, u
 * canvas ga chiziladi va PNG qaytariladi. Barcha uslublar hisoblangan
 * holda koʻchiriladi, shuning uchun natija haqiqiy koʻrinishga yaqin.
 */

import { sandboxDocument } from './sandbox';
import type { Attachment } from './types';

export interface ShotResult {
  ok: boolean;
  /** base64 PNG (prefikssiz) */
  data?: string;
  width: number;
  height: number;
  /** Sahifaning haqiqiy balandligi — rasm kesilgan boʻlishi mumkin */
  fullHeight?: number;
  error?: string;
}

/**
 * Iframe ichida ishlaydigan kod: DOM ni SVG foreignObject ga oʻrab,
 * canvas ga chizadi va natijani ota-oynaga yuboradi.
 */
const SHOOTER = `<script>(function(){
  function send(payload){
    try{ parent.postMessage(Object.assign({__daho:'shot',id:__SHOT_ID__},payload),'*'); }catch(e){}
  }

  /** Hisoblangan uslublarni atributga koʻchiradi — SVG ichida CSS ishlamaydi. */
  function inline(src,dst){
    var cs=getComputedStyle(src),css='';
    for(var i=0;i<cs.length;i++){
      var name=cs[i],value=cs.getPropertyValue(name);
      if(!value) continue;
      css+=name+':'+value+';';
    }
    dst.setAttribute('style',css);
    var a=src.children,b=dst.children;
    for(var j=0;j<a.length&&j<b.length;j++) inline(a[j],b[j]);
  }

  function shoot(){
    try{
      var w=Math.min(document.documentElement.clientWidth||412,900);
      // Balandlikni cheklaymiz: juda uzun rasm modelga koʻp token yeydi
      // va foyda bermaydi — dizayn muammosi yuqori qismda koʻrinadi.
      var full=document.body.scrollHeight||800;
      var h=Math.min(Math.max(full,400),1600);

      var clone=document.body.cloneNode(true);
      // Skript va koʻrinmas elementlar rasmga kerak emas.
      var junk=clone.querySelectorAll('script,noscript,link,meta,iframe');
      for(var k=junk.length-1;k>=0;k--) junk[k].parentNode.removeChild(junk[k]);
      inline(document.body,clone);

      var bg=getComputedStyle(document.body).backgroundColor;
      if(!bg||bg==='rgba(0, 0, 0, 0)'||bg==='transparent') bg='#0e0e12';

      // foreignObject ichi XML boʻlishi SHART: innerHTML yopilmagan teglar
      // (<input>, <br>) qoldiradi va rasm yuklanmaydi. XMLSerializer esa
      // ularni <input/> koʻrinishida, toʻgʻri nom maydoni bilan yozadi.
      var body=new XMLSerializer().serializeToString(clone);
      // <body> tegini <div> ga aylantiramiz — SVG ichida body boʻlmaydi.
      body=body
        .replace(/^<body/i,'<div')
        .replace(/<\\/body>$/i,'</div>');

      var svg=
        '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
        '<rect width="100%" height="100%" fill="'+bg+'"/>'+
        '<foreignObject x="0" y="0" width="'+w+'" height="'+h+'">'+
        '<div xmlns="http://www.w3.org/1999/xhtml" style="width:'+w+'px">'+
        body+
        '</div></foreignObject></svg>';

      var img=new Image();
      img.onload=function(){
        try{
          var canvas=document.createElement('canvas');
          canvas.width=w; canvas.height=h;
          var ctx=canvas.getContext('2d');
          ctx.fillStyle=bg; ctx.fillRect(0,0,w,h);
          ctx.drawImage(img,0,0);
          var url=canvas.toDataURL('image/png');
          send({data:url.slice(url.indexOf(',')+1),width:w,height:h,full:full});
        }catch(e){ send({error:'canvas: '+e.message}); }
      };
      img.onerror=function(){ send({error:'rasmga oʻgirib boʻlmadi'}); };
      img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    }catch(e){ send({error:String(e&&e.message||e)}); }
  }

  setTimeout(shoot,__SHOT_WAIT__);
})();</script>`;

let counter = 0;

/** HTML hujjatni yashirin iframe da chizib, PNG rasmini qaytaradi. */
export function screenshotHtml(html: string, waitMs = 1400): Promise<ShotResult> {
  const id = `shot_${(counter += 1)}`;
  const harness = SHOOTER.replace('__SHOT_ID__', JSON.stringify(id)).replace(
    '__SHOT_WAIT__',
    String(Math.max(300, Math.min(6000, waitMs))),
  );
  const doc = sandboxDocument(html, id).replace(/<\/head>/i, `${harness}</head>`);

  return new Promise<ShotResult>((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:412px;height:900px;border:0;visibility:hidden';

    let done = false;
    const finish = (result: ShotResult) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      frame.remove();
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      const payload = event.data as
        | {
            __daho?: string;
            id?: string;
            data?: string;
            width?: number;
            height?: number;
            full?: number;
            error?: string;
          }
        | null;
      if (!payload || payload.__daho !== 'shot' || payload.id !== id) return;
      if (payload.error || !payload.data) {
        finish({ ok: false, width: 0, height: 0, error: payload.error ?? 'rasm kelmadi' });
        return;
      }
      finish({
        ok: true,
        data: payload.data,
        width: payload.width ?? 0,
        height: payload.height ?? 0,
        fullHeight: payload.full ?? payload.height ?? 0,
      });
    };

    const timer = setTimeout(
      () => finish({ ok: false, width: 0, height: 0, error: 'skrinshot vaqti tugadi' }),
      waitMs + 6000,
    );

    window.addEventListener('message', onMessage);
    frame.srcdoc = doc;
    document.body.appendChild(frame);
  });
}

/** Skrinshotni modelga yuboriladigan qoʻshimcha faylga aylantiradi. */
export function shotToAttachment(shot: ShotResult): Attachment | null {
  if (!shot.ok || !shot.data) return null;
  return { mimeType: 'image/png', data: shot.data, name: 'skrinshot.png' };
}
