/*
 * Klaviatura ochilganda yuqoridagi panel yoʻqolib qolmasin.
 *
 * Muammo: telefon brauzeri klaviaturani chiqarganda sahifaning
 * «layout» balandligi oʻzgarmaydi — brauzer sahifani yuqoriga surib
 * qoʻyadi va topbar ekrandan chiqib ketadi.
 *
 * Yechim ikki qavat:
 *   1. `interactive-widget=resizes-content` (index.html) — zamonaviy
 *      Chrome buni oʻzi hal qiladi;
 *   2. shu yerdagi zaxira — `visualViewport` oʻlchamini `--app-h` ga
 *      yozamiz va sahifani doim yuqoriga qaytaramiz. iOS Safari va
 *      eski Chrome shu yoʻl bilan tuzaladi.
 *
 * Hech qanday oʻlchov boʻlmasa `--app-h` qoʻyilmaydi va CSS avvalgidek
 * `100dvh` ishlatadi.
 */

export function watchViewport(): void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return;

  const root = document.documentElement;
  let ramka = 0;

  const oʻlcha = () => {
    cancelAnimationFrame(ramka);
    ramka = requestAnimationFrame(() => {
      /*
       * `offsetTop` — sahifa qanchaga surilgani. Balandlikka qoʻshamiz,
       * aks holda klaviatura yopilgach pastda boʻsh joy qolardi.
       */
      const h = Math.round(vv.height + vv.offsetTop);
      root.style.setProperty('--app-h', `${h}px`);

      // Brauzer sahifani surib qoʻygan boʻlsa qaytaramiz.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    });
  };

  vv.addEventListener('resize', oʻlcha);
  vv.addEventListener('scroll', oʻlcha);
  oʻlcha();
}
