import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { finishGoogleAuth, listenGoogleRedirect } from './lib/google';
import { hydrate } from './lib/store';
import { registerPwa } from './lib/pwa';
import { watchViewport } from './lib/viewport';
import './styles.css';

registerPwa();
// Klaviatura ochilganda topbar ekrandan chiqib ketmasin.
watchViewport();

const container = document.getElementById('root');
if (!container) throw new Error('#root topilmadi');

const root = createRoot(container);

// Maʼlumot IndexedDB dan oʻqilmaguncha ilovani koʻrsatmaymiz: aks holda
// boʻsh holat ekranga chiqib, birinchi oʻzgarishdayoq bor maʼlumot ustiga
// yozilib ketardi. Oʻqish uzoq choʻzilsa ham ilova ochilaveradi.
const ready = Promise.race([
  hydrate(),
  new Promise<void>((resolve) => setTimeout(resolve, 5000)),
]);

// Telefonda Google tizim brauzerida ochiladi va server deep link bilan
// qaytaradi — shu havolani kutib turamiz.
listenGoogleRedirect((ok, error) => {
  if (!ok && error) console.warn('Google ulanishi tugallanmadi:', error);
});

void ready
  .then(() =>
    // Google OAuth dan qaytgan boʻlsak — manzildagi `code` ni tokenga
    // almashtiramiz. Kod boʻlmasa hech narsa qilinmaydi.
    finishGoogleAuth().catch((err) => {
      console.warn('Google ulanishi tugallanmadi:', err);
    }),
  )
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
