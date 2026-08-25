# Daho — dizayn kanvasi

Ilova, veb va brauzer kengaytmasi uchun bitta dizayn tili.

- `parts/base.css` — tokenlar va umumiy komponent uslublari (`src/styles.css` dan olingan)
- `parts/<Nom>.html` + `parts/<Nom>.css` — har bir artbord mazmuni
- `build.mjs` — `parts/` dan `<Nom>.dc.html` fayllarini yigʻadi
- `canvas.json` — artbordlarning kanvasdagi joylashuvi
- `daho-dizayn.html` — nashr qilingan kanvas (build natijasi, qoʻlda tahrirlanmaydi)

## Oʻzgartirish

```bash
node design/build.mjs      # artbordlarni qayta yigʻish
```

Soʻng kanvasni qayta seed qilib nashr qilish kerak.
