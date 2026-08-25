# Eskizlar

Bu yerda ilovaga kirmagan, lekin saqlab qoʻyilgan sahifalar turadi.

## `nashr-sahifa.html`

Statik HTML dashboard eskizi. U repozitoriy ildizidagi `index.html` ni
almashtirib qoʻygan edi, natijada Vite ilovasi umuman yuklanmay qoldi:
`index.html` — Vite ning KIRISH NUQTASI, unda `<div id="root">` va
`<script type="module" src="/src/main.tsx">` boʻlishi shart.

Eskiz `style.css` va `app.js` fayllariga murojaat qiladi, lekin ular
repozitoriyda yoʻq — shuning uchun sahifa bezaksiz va jonsiz koʻrinardi.

Ishlatmoqchi boʻlsangiz: kerakli CSS va JS ni yozib, uni alohida yoʻlda
(masalan `public/nashr.html`) joylashtiring. Ildizdagi `index.html` ga
tegmang.
