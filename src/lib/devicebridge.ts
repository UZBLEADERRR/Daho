/**
 * Qurilma koʻprigi — qumboxdagi ilovalarga kamera, mikrofon va joylashuv.
 *
 * Muammo: AI yasagan ilova `sandbox` atributli iframe ichida ishlaydi va uning
 * manbasi (origin) «opaque» boʻladi. Brauzer bunday oynaga kamera/mikrofon
 * ruxsatini BERMAYDI — `getUserMedia` darhol «Permission denied» qaytaradi.
 * Sandbox ni olib tashlash esa xavfli: ilova ota-oynadagi maʼlumotga
 * (API kalit, suhbatlar) qoʻl uradigan boʻlib qoladi.
 *
 * Yechim: ruxsat talab qiladigan ishni ota-oyna bajaradi va natijani
 * iframe ga uzatadi. Kameradan olingan kadrlar `ImageBitmap` sifatida
 * (transfer bilan, nusxasiz) yuboriladi, ilova esa ularni oʻz canvas iga
 * chizib, undan haqiqiy `MediaStream` yasaydi. Mikrofon uchun PCM boʻlaklari,
 * joylashuv uchun koordinata yuboriladi.
 *
 * Natijada ilova oddiy `navigator.mediaDevices.getUserMedia` ni chaqiradi va
 * hamma narsa ishlaydi, qumbox esa buzilmaydi.
 */

const FPS = 20;

interface Session {
  stop: () => void;
}

const sessions = new Map<string, Session>();
const watches = new Map<string, number>();

function reply(source: MessageEventSource | null, payload: Record<string, unknown>): void {
  try {
    (source as Window | null)?.postMessage(payload, '*');
  } catch {
    /* oyna yopilgan boʻlishi mumkin */
  }
}

function send(
  source: MessageEventSource | null,
  payload: Record<string, unknown>,
  transfer: Transferable[],
): void {
  try {
    (source as Window | null)?.postMessage(payload, '*', transfer);
  } catch {
    /* oyna yopilgan */
  }
}

/** Kameradan kadr, mikrofondan tovush uzatishni boshlaydi. */
async function startMedia(
  source: MessageEventSource | null,
  req: string,
  wantVideo: boolean,
  wantAudio: boolean,
  facing: string,
): Promise<void> {
  const constraints: MediaStreamConstraints = {
    video: wantVideo
      ? { facingMode: facing === 'environment' ? 'environment' : 'user', width: { ideal: 960 } }
      : false,
    audio: wantAudio,
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    reply(source, {
      __daho: 'media-err',
      req,
      name: (err as Error)?.name ?? 'NotAllowedError',
      message: String((err as Error)?.message ?? err),
    });
    return;
  }

  let stopped = false;
  const cleanup: Array<() => void> = [
    () => stream.getTracks().forEach((t) => t.stop()),
  ];

  // ---- video: kadrlarni ImageBitmap qilib uzatamiz
  if (wantVideo && stream.getVideoTracks().length) {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch {
      /* ba'zi brauzerlarda avtomatik ijro kechikadi */
    }

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    reply(source, {
      __daho: 'media-ok',
      req,
      video: true,
      audio: wantAudio && stream.getAudioTracks().length > 0,
      width: settings.width ?? video.videoWidth ?? 640,
      height: settings.height ?? video.videoHeight ?? 480,
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const pump = async () => {
      if (stopped) return;
      try {
        if (video.videoWidth) {
          const bitmap = await createImageBitmap(video);
          send(source, { __daho: 'frame', req, bitmap }, [bitmap]);
        }
      } catch {
        /* kadr tushmadi — keyingisi keladi */
      }
      timer = setTimeout(() => void pump(), 1000 / FPS);
    };
    void pump();

    cleanup.push(() => {
      if (timer) clearTimeout(timer);
      video.srcObject = null;
    });
  } else {
    reply(source, {
      __daho: 'media-ok',
      req,
      video: false,
      audio: stream.getAudioTracks().length > 0,
      width: 0,
      height: 0,
    });
  }

  // ---- audio: PCM boʻlaklari
  if (wantAudio && stream.getAudioTracks().length) {
    try {
      const ctx = new AudioContext();
      const input = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const silence = ctx.createGain();
      silence.gain.value = 0; // ovoz karnayga qaytmasin (aks-sado boʻlmasin)

      processor.onaudioprocess = (event) => {
        if (stopped) return;
        const channel = event.inputBuffer.getChannelData(0);
        const chunk = new Float32Array(channel.length);
        chunk.set(channel);
        send(source, { __daho: 'pcm', req, rate: ctx.sampleRate, data: chunk }, [chunk.buffer]);
      };

      input.connect(processor);
      processor.connect(silence);
      silence.connect(ctx.destination);

      cleanup.push(() => {
        processor.onaudioprocess = null;
        processor.disconnect();
        input.disconnect();
        void ctx.close();
      });
    } catch {
      /* audio qayta yigʻilmadi — video baribir ishlaydi */
    }
  }

  sessions.set(req, {
    stop: () => {
      if (stopped) return;
      stopped = true;
      cleanup.forEach((fn) => {
        try {
          fn();
        } catch {
          /* ahamiyatsiz */
        }
      });
      sessions.delete(req);
    },
  });
}

function handleGeo(source: MessageEventSource | null, req: string, watch: boolean): void {
  if (!navigator.geolocation) {
    reply(source, { __daho: 'geo-err', req, message: 'Qurilmada joylashuv yoʻq' });
    return;
  }
  const ok = (pos: GeolocationPosition) =>
    reply(source, {
      __daho: 'geo',
      req,
      coords: {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
      },
      timestamp: pos.timestamp,
    });
  const fail = (err: GeolocationPositionError) =>
    reply(source, { __daho: 'geo-err', req, code: err.code, message: err.message });

  const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 };
  if (watch) {
    watches.set(req, navigator.geolocation.watchPosition(ok, fail, options));
  } else {
    navigator.geolocation.getCurrentPosition(ok, fail, options);
  }
}

/**
 * Ilova ishga tushganda bir marta chaqiriladi. Qumboxdagi ilovalardan
 * keladigan soʻrovlarni tinglaydi.
 */
export function installDeviceBridge(): () => void {
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { __daho?: string; req?: string; [k: string]: unknown } | null;
    if (!data || typeof data.__daho !== 'string') return;
    const req = typeof data.req === 'string' ? data.req : '';

    switch (data.__daho) {
      case 'media-ask':
        void startMedia(
          event.source,
          req,
          Boolean(data.video),
          Boolean(data.audio),
          String(data.facing ?? 'user'),
        );
        break;

      case 'media-stop':
        sessions.get(req)?.stop();
        break;

      case 'geo-ask':
        handleGeo(event.source, req, Boolean(data.watch));
        break;

      case 'geo-stop': {
        const id = watches.get(req);
        if (id !== undefined) {
          navigator.geolocation.clearWatch(id);
          watches.delete(req);
        }
        break;
      }

      case 'clipboard':
        void navigator.clipboard?.writeText(String(data.text ?? '')).catch(() => undefined);
        break;

      default:
        break;
    }
  };

  window.addEventListener('message', onMessage);
  return () => {
    window.removeEventListener('message', onMessage);
    sessions.forEach((s) => s.stop());
    watches.forEach((id) => navigator.geolocation.clearWatch(id));
    watches.clear();
  };
}

/** Ilova yopilganda uning oqimlarini toʻxtatadi. */
export function stopAllDeviceStreams(): void {
  sessions.forEach((s) => s.stop());
}
