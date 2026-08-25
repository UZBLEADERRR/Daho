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

/**
 * Qumboxdagi ilovaga beriladigan qurilma imkoniyatlari.
 * `allow` boʻlmasa brauzer kamera/mikrofonni umuman soʻramaydi.
 */
export const IFRAME_ALLOW =
  'camera; microphone; geolocation; autoplay; clipboard-write; fullscreen; ' +
  'encrypted-media; picture-in-picture; accelerometer; gyroscope; magnetometer; ' +
  'xr-spatial-tracking; midi';

/**
 * Qumbox darajasi. `allow-same-origin` ATAYLAB yoʻq — aks holda ilova
 * ota-oynadagi maʼlumotga (API kalit, suhbatlar) qoʻl ura olardi.
 * Kamera va joylashuv oʻrniga qurilma koʻprigi ishlaydi (bridgeScript).
 */
export const IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';

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

/**
 * Qurilma koʻprigi — iframe tomoni.
 *
 * `getUserMedia`, `geolocation` va `clipboard` ni ota-oynaga uzatadi.
 * Sabab: qumboxdagi oyna «opaque origin» da boʻlgani uchun brauzer unga
 * kamera/mikrofon ruxsatini bermaydi (`NotAllowedError`). Kadrlar ota-oynadan
 * `ImageBitmap` boʻlib keladi, biz ularni canvas ga chizamiz va shu canvas dan
 * haqiqiy `MediaStream` yasaymiz — ilova farqni sezmaydi.
 */
function bridgeScript(): string {
  return `<script>(function(){
  var seq=0, media={}, geo={};
  function id(){seq+=1;return 'r'+seq+'_'+Date.now()}
  function tell(msg){try{parent.postMessage(msg,'*')}catch(e){}}

  window.addEventListener('message',function(ev){
    var d=ev.data; if(!d||typeof d.__daho!=='string')return;
    var m=media[d.req], g=geo[d.req];
    if(d.__daho==='media-ok'&&m){m.ready(d)}
    else if(d.__daho==='media-err'&&m){m.fail(d)}
    else if(d.__daho==='frame'&&m&&m.draw){m.draw(d.bitmap)}
    else if(d.__daho==='pcm'&&m&&m.audio){m.audio(d.data,d.rate)}
    else if(d.__daho==='geo'&&g){g.ok({coords:d.coords,timestamp:d.timestamp})}
    else if(d.__daho==='geo-err'&&g){g.fail({code:d.code||1,message:d.message||'xato',
      PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3})}
  });

  function getUserMedia(c){
    c=c||{};
    var wantVideo=!!c.video, wantAudio=!!c.audio;
    if(!wantVideo&&!wantAudio)return Promise.reject(new Error('TypeError: video yoki audio kerak'));
    var facing='user';
    if(c.video&&typeof c.video==='object'){
      var f=c.video.facingMode;
      if(typeof f==='string')facing=f;
      else if(f&&(f.exact||f.ideal))facing=f.exact||f.ideal;
    }
    var req=id();
    return new Promise(function(resolve,reject){
      var slot={};
      media[req]=slot;
      slot.fail=function(d){delete media[req];var e=new Error(d.message||'ruxsat berilmadi');e.name=d.name||'NotAllowedError';reject(e)};
      slot.ready=function(d){
        var stream, canvas, ctx;
        if(d.video){
          canvas=document.createElement('canvas');
          canvas.width=d.width||640; canvas.height=d.height||480;
          ctx=canvas.getContext('2d');
          stream=canvas.captureStream(20);
          slot.draw=function(bitmap){
            try{
              if(bitmap.width&&(canvas.width!==bitmap.width||canvas.height!==bitmap.height)){
                canvas.width=bitmap.width; canvas.height=bitmap.height;
              }
              ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
              if(bitmap.close)bitmap.close();
            }catch(e){}
          };
        } else {
          stream=new MediaStream();
        }
        if(d.audio){
          try{
            var AC=window.AudioContext||window.webkitAudioContext;
            var actx=new AC();
            var dest=actx.createMediaStreamDestination();
            var at=0;
            slot.audio=function(data,rate){
              try{
                var buf=actx.createBuffer(1,data.length,rate||actx.sampleRate);
                buf.copyToChannel?buf.copyToChannel(data,0):buf.getChannelData(0).set(data);
                var src=actx.createBufferSource();
                src.buffer=buf; src.connect(dest);
                var now=actx.currentTime;
                if(at<now)at=now+0.05;
                src.start(at); at+=buf.duration;
              }catch(e){}
            };
            var atrack=dest.stream.getAudioTracks()[0];
            if(atrack&&stream.addTrack)stream.addTrack(atrack);
          }catch(e){}
        }
        // Toʻxtatish ota-oynaga ham yetib borsin.
        try{
          stream.getTracks().forEach(function(t){
            var orig=t.stop.bind(t);
            t.stop=function(){orig();tell({__daho:'media-stop',req:req});delete media[req]};
          });
        }catch(e){}
        resolve(stream);
      };
      tell({__daho:'media-ask',req:req,video:wantVideo,audio:wantAudio,facing:facing});
      setTimeout(function(){
        if(media[req]&&!slot.draw&&!slot.audio){
          // Javob kelmadi — ilova muzlab qolmasin.
        }
      },20000);
    });
  }

  var devices={
    getUserMedia:getUserMedia,
    enumerateDevices:function(){return Promise.resolve([
      {deviceId:'daho-cam',kind:'videoinput',label:'Kamera',groupId:'daho'},
      {deviceId:'daho-mic',kind:'audioinput',label:'Mikrofon',groupId:'daho'}
    ])},
    getSupportedConstraints:function(){return {facingMode:true,width:true,height:true}},
    addEventListener:function(){},removeEventListener:function(){}
  };
  try{Object.defineProperty(navigator,'mediaDevices',{configurable:true,get:function(){return devices}})}catch(e){}
  try{navigator.getUserMedia=function(c,ok,err){getUserMedia(c).then(ok,err)};
      navigator.webkitGetUserMedia=navigator.getUserMedia}catch(e){}

  var geolocation={
    getCurrentPosition:function(ok,err){
      var req=id();
      geo[req]={ok:function(p){delete geo[req];ok&&ok(p)},fail:function(e){delete geo[req];err&&err(e)}};
      tell({__daho:'geo-ask',req:req,watch:false});
    },
    watchPosition:function(ok,err){
      var req=id();
      geo[req]={ok:function(p){ok&&ok(p)},fail:function(e){err&&err(e)}};
      tell({__daho:'geo-ask',req:req,watch:true});
      return req;
    },
    clearWatch:function(req){delete geo[req];tell({__daho:'geo-stop',req:req})}
  };
  try{Object.defineProperty(navigator,'geolocation',{configurable:true,get:function(){return geolocation}})}catch(e){}

  try{
    var clip=navigator.clipboard||{};
    var write=function(t){tell({__daho:'clipboard',text:String(t)});return Promise.resolve()};
    Object.defineProperty(navigator,'clipboard',{configurable:true,get:function(){
      return {writeText:write,readText:clip.readText?clip.readText.bind(clip):function(){return Promise.resolve('')}}
    }});
  }catch(e){}

  try{
    var perms=navigator.permissions;
    if(perms&&perms.query){
      var q=perms.query.bind(perms);
      perms.query=function(o){
        var n=o&&o.name;
        if(n==='camera'||n==='microphone'||n==='geolocation')
          return Promise.resolve({state:'granted',onchange:null,addEventListener:function(){},removeEventListener:function(){}});
        return q(o);
      };
    }
  }catch(e){}
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
  const head = storeScript(id) + bridgeScript();
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
