/*
 * Koʻnikmalar (skills).
 *
 * Har bir koʻnikma — bitta ish turi uchun tayyor koʻrsatma: qanday
 * savol berish, qanday tuzilma, qanday tekshirish. Ular ikki yoʻl
 * bilan yoqiladi:
 *
 *   1. Foydalanuvchi yozish maydonida `/` bosadi va roʻyxatdan tanlaydi;
 *   2. Model oʻzi mos koʻnikmani `use_skill` bilan ochadi.
 *
 * Nega alohida: bu koʻrsatmalarning hammasini tizim promptiga tiqsak
 * har bir soʻrovga ~8 000 qoʻshimcha token ketardi — hatto «salom»
 * deganda ham. Endi modelga faqat BIR QATORLI roʻyxat koʻrsatiladi,
 * toʻliq matn esa koʻnikma tanlangandagina qoʻshiladi.
 */

export interface Skill {
  id: string;
  icon: string;
  name: string;
  /** Bir qator — tanlagichda ham, model koʻradigan roʻyxatda ham */
  summary: string;
  /** Qaysi vosita guruhlari kerak */
  groups: string[];
  /** Model oʻzi tanlashi uchun kalit soʻzlar */
  hint: RegExp;
  /** Faol boʻlgandagina promptga qoʻshiladi */
  instruction: string;
}

export const SKILLS: Skill[] = [
  {
    id: 'kitob',
    icon: '📚',
    name: 'Kitob yozish',
    summary: 'Koʻp bobli kitob yoki qoʻllanma — reja, boblar, tahrir',
    groups: ['ijod'],
    hint: /kitob|qoʻllanma|qollanma|monografiya|roman|hikoyalar toʻplami/i,
    instruction: `## Koʻnikma: kitob yozish 📚
Matnni chatda oʻzing yozma — bitta javob chegarasi bor va bob oʻrtada uziladi.

1. Avval \`ask_user\` bilan BITTALAB soʻra (har birida tayyor variantlar):
   mavzu, kimga moʻljallangan, uslub (ilmiy/ommabop/badiiy), taxminan
   necha bob, rasm kerakmi.
2. Javoblarni bitta toʻliq tavsifga yigʻ va \`write_book\` ni bir marta chaqir.
3. Bob nomlarini oʻzing taklif qilma — foydalanuvchi bergan yoʻnalishdan
   chiqar. Har bob oldingisiga tayanishi kerak, takror boʻlmasin.
4. Yozilgach: qayerdan oʻqish va qaysi bobni qayta yozdirish mumkinligini ayt.`,
  },
  {
    id: 'imtihon',
    icon: '📝',
    name: 'Test va imtihon',
    summary: 'Savollar, variantlar, javob kaliti va tahlil',
    groups: ['reja'],
    hint: /test|imtihon|savol tuz|quiz|nazorat ishi|attestatsiya|dtm/i,
    instruction: `## Koʻnikma: test tuzish 📝
1. Aniqlab ol: fan/mavzu, daraja, nechta savol, turi (yopiq/ochiq/aralash),
   vaqt chegarasi. Aytilmagan boʻlsa: 20 ta yopiq savol, oʻrta daraja.
2. Savollarni QIYINLIK boʻyicha oʻstirib bor: oson → oʻrta → qiyin.
3. Har yopiq savolda 4 variant. Notoʻgʻri variantlar HAM ishonarli boʻlsin —
   «aniq notoʻgʻri» variant savolni bekorga aylantiradi.
4. Javob kaliti oxirida, alohida boʻlimda. Har javobga bir jumlalik izoh:
   nega toʻgʻri va nega qolganlari notoʻgʻri.
5. Bir mavzuni ikki marta soʻrama; mavzular boʻyicha qamrovni tekshirib chiq.`,
  },
  {
    id: 'ilmiy',
    icon: '🔬',
    name: 'Ilmiy ish',
    summary: 'Referat, kurs ishi, maqola — tuzilma va manbalar',
    groups: ['ijod'],
    hint: /referat|kurs ishi|diplom|bitiruv|maqola|ilmiy|tadqiqot|dissertatsiya/i,
    instruction: `## Koʻnikma: ilmiy ish 🔬
Tuzilma: kirish (dolzarblik, maqsad, vazifalar) → asosiy qism (boblar) →
xulosa → foydalanilgan adabiyotlar.

- **Manbani oʻylab topma.** Har bir daʼvo uchun \`search_web\` bilan haqiqiy
  manba top va havolasini yoz. Topa olmasang «manba topilmadi» deb belgila —
  soxta havola ilmiy ishni yaroqsiz qiladi.
- Har bobning oxirida qisqa xulosa boʻlsin.
- Raqam va statistika boʻlsa yilini va manbasini koʻrsat, \`\`\`chart bilan chiz.
- Kirish va xulosani ENG OXIRIDA yoz — shunda ular asosiy qismga mos tushadi.
- Hajm soʻralmasa: referat 12–15 bet, kurs ishi 25–30 bet miqyosida rejalashtir.`,
  },
  {
    id: 'xat',
    icon: '✉️',
    name: 'Rasmiy xat',
    summary: 'Ariza, tushuntirish xati, shikoyat, taklif',
    groups: [],
    hint: /ariza|rasmiy xat|shikoyat|tushuntirish xati|murojaat|bayonnoma|taklif xati/i,
    instruction: `## Koʻnikma: rasmiy xat ✉️
1. Kimga (lavozimi va tashkiloti), kimdan (F.I.SH., aloqa) — aniq boʻlmasa soʻra.
2. Tuzilma: sarlavha → murojaat → holat bayoni (aniq sana va faktlar bilan) →
   talab/iltimos → ilova roʻyxati → sana va imzo joyi.
3. Uslub: quruq, hurmatli, hissiyotsiz. Bir jumlada bitta fikr.
4. Faktni oʻzingdan toʻqima — bilmagan joyingni \`[...]\` qilib qoldir va
   nima yozish kerakligini ayt.
5. Yuridik maslahat berma: «huquqshunos bilan maslahatlashing» deb ogohlantir.`,
  },
  {
    id: 'rezyume',
    icon: '💼',
    name: 'Rezyume',
    summary: 'CV va motivatsion xat — ish beruvchi koʻzi bilan',
    groups: ['ijod'],
    hint: /rezyume|cv\b|resume|motivatsion xat|cover letter|ish oʻrni|vakansiya/i,
    instruction: `## Koʻnikma: rezyume 💼
- Har bandni **natija** bilan yoz: «X qildim → Y natija (raqam bilan)».
  «Masʼul edim» kabi jumlalar hech narsa demaydi.
- Tartib: aloqa → qisqa taʼrif (3 qator) → tajriba (yangidan eskiga) →
  taʼlim → koʻnikmalar → tillar.
- Vakansiya matni berilsa: undagi soʻzlarni ishlat — koʻp kompaniya
  rezyumeni avval dastur bilan saralaydi.
- Bir bet. Ikkinchi betga oʻtsa — eng eski va eng zaif bandni olib tashla.
- Yolgʻon tajriba qoʻshma. Tajriba kam boʻlsa loyiha va oʻqishni oldinga chiqar.`,
  },
  {
    id: 'tahlil',
    icon: '📊',
    name: 'Maʼlumot tahlili',
    summary: 'Jadval va raqamlarni tahlil qilib grafik chizadi',
    groups: ['ijod'],
    hint: /tahlil qil|statistik|jadval|excel|csv|dinamika|taqqosla|hisobot tuz/i,
    instruction: `## Koʻnikma: maʼlumot tahlili 📊
1. Avval maʼlumotni TUSHUN: nechta qator, qaysi ustunlar, qaysi davr.
   Buni bir jumlada aytib qoʻy.
2. Xom raqamni qaytarma — **xulosani** ayt: nima oʻsdi, nima tushdi,
   qayerda gʻayrioddiylik bor.
3. Har muhim raqamni \`\`\`chart bloki bilan chiz. Taqqoslash — ustun,
   dinamika — chiziq, ulush — doira.
4. Sabab-natijani ehtiyot boʻlib ayt: bogʻliqlik sababni anglatmaydi.
5. Oxirida 3 ta aniq tavsiya ber — «nima qilish kerak».`,
  },
  {
    id: 'tarjima',
    icon: '🌐',
    name: 'Tarjima',
    summary: 'Maʼnoni saqlagan tarjima, atamalar izohi bilan',
    groups: [],
    hint: /tarjima|tarjima qil|translate|oʻgir|ingliz tiliga|rus tiliga/i,
    instruction: `## Koʻnikma: tarjima 🌐
- Soʻzma-soʻz emas, **maʼnoni** tarjima qil. Oʻzbekchada tabiiy jaranglasin.
- Atama va qisqartmalarni birinchi uchraganda qavsda asl holida qoldir:
  «mashinali oʻrganish (machine learning)».
- Uslubni saqla: rasmiy matn rasmiy, soʻzlashuv soʻzlashuv boʻlib qolsin.
- Ikki maʼnoli joyni tarjima qilib qoʻyaverma — qaysi maʼno kerakligini soʻra.
- Oʻlchov, sana va pul birliklarini mahalliy koʻrinishga keltir.`,
  },
  {
    id: 'mijoz',
    icon: '💬',
    name: 'Mijozlarga javob',
    summary: 'Izoh va xabarlarni guruhlab, har biriga alohida javob',
    groups: ['telegram', 'ijtimoiy'],
    hint: /mijoz|izohlarga javob|direct|buyurtma|savdo|obunachi|xaridor/i,
    instruction: `## Koʻnikma: mijozlarga javob 💬
1. **Avval oʻqi, keyin yoz.** Hammasini olib chiq, javobsizlarini ajrat,
   mavzu boʻyicha guruhla.
2. Hisobot ber: «40 ta xabar: 18 tasi narx, 12 tasi vaqt, 6 tasi maqtov,
   4 tasi spam». Foydalanuvchi shuni koʻrib qaror qiladi.
3. Har biriga ALOHIDA javob — ismini ishlatib, savoliga mos. Bir xil matnni
   koʻchirma: platformalar buni spam deb belgilaydi.
4. Birinchi 3–5 tasini koʻrsatib TASDIQLAT, keyin davom et.
5. Narx, muddat va shaxsiy shartni OʻZINGDAN aytma.
6. Haqorat va spamga javob berma — yashir va hisobotda ayt.`,
  },
  {
    id: 'taqdimot',
    icon: '🖼',
    name: 'Taqdimot',
    summary: 'Slaydlar: bitta slayd — bitta fikr',
    groups: ['ijod'],
    hint: /taqdimot|slayd|prezentatsiya|powerpoint|pptx|chiqish qilaman/i,
    instruction: `## Koʻnikma: taqdimot 🖼
Taqdimotni markdown bilan yozasan, keyin \`send_file\` bilan .pptx qilib berasan.
Har bir \`##\` — bitta slayd.

**Muhim:** slayd maketi MAZMUN SHAKLIGA qarab avtomatik tanlanadi.
Shuning uchun quyidagi shakllarni ataylab ishlat — shunda taqdimot
matn roʻyxati emas, haqiqiy dizaynga ega boʻladi:

| Nima yozsang | Qanday chiqadi |
| --- | --- |
| \`##\` va punkt yoʻq | Boʻlim ajratkichi — katta sarlavha, tartib raqami |
| Raqam bilan boshlanuvchi 2-4 punkt (\`68% — kompaniyalar\`) | Katta rangli raqam kartalari |
| Sarlavhada «vs», «eski va yangi», «afzallik va kamchilik» | Ikki ustunli taqqoslash |
| \`1.\` \`2.\` \`3.\` raqamlangan roʻyxat | Raqamlangan qadamlar zanjiri |
| 3-6 ta qisqa punkt, har biri \`Nom — izoh\` | Kartalar toʻri |
| Bitta uzun jumla | Katta iqtibos slaydi |
| Rasm qoʻshilgan slayd | Matn chapda, rasm oʻngda |

Qoidalar:
- **Bitta slayd — bitta fikr.** Slaydga matn toʻkma.
- Sarlavha fikrni OʻZI aytib tursin: «Sotuv 3 barobar oshdi», «Natijalar» emas.
- Raqam boʻlsa uni ALBATTA raqam slaydiga chiqar — eng kuchli taʼsir shunda.
- Har 4-5 slayddan keyin boʻlim ajratkichi qoʻy — taqdimot nafas olsin.
- Birinchi slaydga muqova rasmi kerak boʻlsa \`generate_image\` bilan chiz.
- Notiq uchun izohni slaydga yozma — javob matnida alohida ber.

Namuna:

\`\`\`
## Bozor holati

## Raqamlar
- 68% — kompaniyalar AI ni sinab koʻrgan
- 3.2 mln — dasturchi AI vositalarini ishlatadi
- 12 soat — haftasiga tejaladi

## Eski va yangi usul
- Qoʻlda — koʻp vaqt, koʻp xato
- AI bilan — tez, lekin tekshirish shart

## Qanday boshlash
1. Maqsadni aniqlang
2. Kichik loyihada sinang
3. Natijani oʻlchang
\`\`\``,
  },
  {
    id: 'oqituvchi',
    icon: '🎓',
    name: 'Tushuntirish',
    summary: 'Murakkab mavzuni bosqichma-bosqich, misollar bilan',
    groups: [],
    hint: /tushuntir|oʻrgat|nima uchun|qanday ishlaydi|farqi nima|sodda qilib/i,
    instruction: `## Koʻnikma: tushuntirish 🎓
1. Bir jumlada **eng sodda javob** — hech qanday atamasiz.
2. Kundalik hayotdan oʻxshatish ber.
3. Keyin haqiqiy taʼrif va mexanizm: nima uchun aynan shunday.
4. Bitta toʻliq ishlangan misol — har qadamni koʻrsat, natijani tashlab ketma.
5. Koʻp uchraydigan XATO nima ekanini ayt — bu tushunishni mustahkamlaydi.
6. Oxirida 2 ta oʻz-oʻzini tekshirish savoli ber (javobi bilan).
Formulalarni oddiy belgilar bilan yoz (x², √, ∫, ≈), LaTeX ishlatma.`,
  },
];

/** `/` dan keyin yozilgan matn boʻyicha filtrlaydi. */
export function findSkills(query: string): Skill[] {
  const term = query.trim().toLowerCase();
  if (!term) return SKILLS;
  return SKILLS.filter(
    (s) =>
      s.id.includes(term) ||
      s.name.toLowerCase().includes(term) ||
      s.summary.toLowerCase().includes(term),
  );
}

export function skillById(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

/** Matndan mos koʻnikmani taxmin qiladi (model oʻzi ochmasa ham ishlasin). */
export function guessSkill(text: string): Skill | undefined {
  return SKILLS.find((s) => s.hint.test(text));
}

/**
 * Model koʻradigan roʻyxat — bir qatordan.
 *
 * Toʻliq koʻrsatmalar ~8 000 token; bu roʻyxat ~200. Model kerakligini
 * koʻrsa `use_skill` bilan ochadi va keyingi qadamda toʻliq matn keladi.
 */
export function skillIndex(activeId?: string): string {
  const rows = SKILLS.filter((s) => s.id !== activeId).map(
    (s) => `- \`${s.id}\` — ${s.summary}`,
  );
  if (!rows.length) return '';
  return [
    '## Koʻnikmalar 🎯',
    'Ish shu turlardan biriga toʻgʻri kelsa `use_skill` bilan och — keyingi',
    'qadamda oʻsha ish uchun toʻliq koʻrsatma keladi. Oddiy savolga ochma.',
    ...rows,
  ].join('\n');
}
