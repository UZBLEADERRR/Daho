/**
 * Qumbox (sandbox) yordamchisi.
 *
 * AI yasagan ilovalar `sandbox` atributli iframe ichida ishlaydi. Bunday
 * iframe "opaque origin" da boʻlgani uchun `localStorage` ga murojaat qilish
 * SecurityError beradi — natijada ilova ochilishi bilan oʻlib qoladi va
 * foydalanuvchi boʻsh ekran koʻradi (koʻp ilovalar maʼlumotni localStorage da
 * saqlaydi).
 *
 * Yechim: iframe ichiga localStorage oʻrnini bosuvchi qatlam quyamiz. Oʻqish
 * xotiradan (ochilishda ota-oynadan urugʻ sifatida beriladi), yozish esa
 * postMessage orqali ota-oynaga qaytadi va u haqiqiy localStorage ga saqlaydi.
 * Shu tariqa API sinxron qoladi, maʼlumot esa yoʻqolmaydi.
 */

const PREFIX = 'daho.sandbox.';
const LIMIT = 2_000_000; // bitta ilova uchun ~2 MB

export function sandboxKey(id: string): string {
  return PREFIX + id;
}

function readSeed(id: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(sandboxKey(id));
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? (data as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** `</script>` va shunga oʻxshash ketma-ketliklar hujjatni buzmasligi uchun. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function storeScript(id: string): string {
  return `<script>(function(){
  var ID=${safeJson(id)};
  var mem=${safeJson(readSeed(id))};
  function push(){try{parent.postMessage({__daho:'store',id:ID,data:mem},'*')}catch(e){}}
  function base(){
    return {
      getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(mem,k)?String(mem[k]):null},
      setItem:function(k,v){mem[String(k)]=String(v);push()},
      removeItem:function(k){delete mem[String(k)];push()},
      clear:function(){mem={};push()},
      key:function(i){var ks=Object.keys(mem);return i<ks.length?ks[i]:null}
    };
  }
  function make(){
    var api=base();
    if(typeof Proxy!=='function')return api;
    return new Proxy(api,{
      get:function(t,p){
        if(p==='length')return Object.keys(mem).length;
        if(p in t)return t[p];
        if(typeof p==='string')return Object.prototype.hasOwnProperty.call(mem,p)?String(mem[p]):undefined;
        return undefined;
      },
      set:function(t,p,v){if(typeof p==='string'){mem[p]=String(v);push()}return true},
      deleteProperty:function(t,p){if(typeof p==='string'){delete mem[p];push()}return true},
      has:function(t,p){return (p in t)||Object.prototype.hasOwnProperty.call(mem,p)},
      ownKeys:function(){return Object.keys(mem)},
      getOwnPropertyDescriptor:function(t,p){
        if(Object.prototype.hasOwnProperty.call(mem,p))
          return {value:String(mem[p]),writable:true,enumerable:true,configurable:true};
        return undefined;
      }
    });
  }
  var ok=false;
  try{window.localStorage.getItem('__daho');ok=true}catch(e){ok=false}
  if(!ok){
    var store=make();
    try{Object.defineProperty(window,'localStorage',{configurable:true,get:function(){return store}})}catch(e){}
    try{Object.defineProperty(window,'sessionStorage',{configurable:true,get:function(){return store}})}catch(e){}
  }
})();</script>`;
}

/** Ota-oyna tomonida: ilovalar saqlagan maʼlumotni qabul qilib qoʻyadi. */
export function installSandboxStore(): () => void {
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { __daho?: string; id?: string; data?: unknown } | null;
    if (!data || data.__daho !== 'store' || typeof data.id !== 'string') return;
    try {
      const text = JSON.stringify(data.data ?? {});
      if (text.length > LIMIT) return;
      localStorage.setItem(sandboxKey(data.id), text);
    } catch {
      /* xotira toʻlgan boʻlishi mumkin — ilova baribir ishlayveradi */
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/** Ilovaning saqlangan maʼlumotini oʻchiradi. */
export function clearSandboxStore(id: string): void {
  try {
    localStorage.removeItem(sandboxKey(id));
  } catch {
    /* ahamiyatsiz */
  }
}

/**
 * HTML hujjatni iframe ichida ishlashga tayyorlaydi: saqlash qatlamini va
 * telefon uchun `viewport` metasini qoʻshadi.
 */
export function sandboxDocument(html: string, id: string): string {
  const head = storeScript(id);
  const meta =
    /<meta[^>]+viewport/i.test(html)
      ? ''
      : '<meta name="viewport" content="width=device-width,initial-scale=1">';

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (m) => `${m}${meta}${head}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, (m) => `${m}<head>${meta}${head}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${meta}${head}</head><body>${html}</body></html>`;
}
