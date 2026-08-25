/*
 * Daho nima qila oladi — foydalanuvchiga koʻrsatiladigan roʻyxat.
 *
 * Ilgari bu hech qayerda yozilmagan edi: vositalar faqat model
 * promptida turardi, foydalanuvchi esa ilova nimaga qodirligini
 * taxmin qilib yurardi. Endi Agent boʻlimida galereya boʻlib chiqadi
 * va bosilganda tayyor soʻrov chatga tushadi.
 */

export interface Capability {
  id: string;
  icon: string;
  title: string;
  /** Bir jumlada — nima qiladi */
  what: string;
  /** Bosilganda chatga tushadigan matn */
  prompt: string;
  /** Ishlashi uchun nima kerak */
  needs?: 'gemini' | 'github' | 'ulanish';
}

export interface CapabilityGroup {
  id: string;
  title: string;
  hint: string;
  items: Capability[];
}

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    id: 'oqish',
    title: 'Oʻqish va tushunish',
    hint: 'Mavzuni oching, konspekt va kurs qilib bering',
    items: [
      {
        id: 'tushuntir',
        icon: '🧠',
        title: 'Mavzuni tushuntirish',
        what: 'Murakkab mavzuni sodda, bosqichma-bosqich, misollar bilan yoritadi.',
        prompt: 'Menga «» mavzusini bosqichma-bosqich, misollar bilan tushuntir.',
      },
      {
        id: 'konspekt',
        icon: '📝',
        title: 'Konspekt yozish',
        what: 'Darsdan yoki matndan tartibli konspekt tuzadi va saqlaydi.',
        prompt: 'Quyidagi mavzudan konspekt tuz va saqlab qoʻy: ',
      },
      {
        id: 'kurs',
        icon: '🎓',
        title: 'Kurs ochish',
        what: 'Maqsadingizdan mavzular rejasini tuzadi, har birini darsga aylantiradi.',
        prompt: 'Menga «» boʻyicha kurs ochib ber — mavzular rejasi bilan.',
      },
      {
        id: 'kitob',
        icon: '📚',
        title: 'Kitob yozish',
        what: 'Bob-bob rejalashtiradi va har birini toʻliq yozadi, rasm bilan.',
        prompt: 'Menga «» mavzusida kitob yozib ber.',
      },
      {
        id: 'test',
        icon: '❓',
        title: 'Test tuzish',
        what: 'Bilimni tekshirish uchun interaktiv test yasaydi.',
        prompt: 'Menga «» mavzusidan 15 savollik interaktiv test tuzib ber.',
      },
    ],
  },
  {
    id: 'yasash',
    title: 'Yaratish',
    hint: 'Ilova, hujjat, rasm, video',
    items: [
      {
        id: 'ilova',
        icon: '🧩',
        title: 'Ilova yasash',
        what: 'Ishlaydigan kalkulyator, oʻyin, vositani bitta HTML fayl qilib beradi.',
        prompt: 'Menga shunday ilova yasab ber: ',
      },
      {
        id: 'rasm',
        icon: '🎨',
        title: 'Rasm chizish',
        what: 'Tavsifingiz boʻyicha rasm yasaydi.',
        prompt: 'Menga shunday rasm chizib ber: ',
        needs: 'gemini',
      },
      {
        id: 'video',
        icon: '🎬',
        title: 'Video yasash',
        what: 'Ssenariy, sahna rasmlari, diktor ovozi va subtitr bilan video yigʻadi.',
        prompt: 'Menga «» mavzusida qisqa video yasab ber.',
        needs: 'gemini',
      },
      {
        id: 'hujjat',
        icon: '📄',
        title: 'Hujjat tayyorlash',
        what: 'Word, PDF yoki slayd qilib chiqaradi.',
        prompt: 'Quyidagi mavzuda hujjat tayyorlab, Word fayl qilib ber: ',
      },
      {
        id: 'grafik',
        icon: '📊',
        title: 'Grafik chizish',
        what: 'Sonlardan ustun, chiziq yoki doira diagramma yasaydi.',
        prompt: 'Bu sonlarni grafik qilib koʻrsat: ',
      },
    ],
  },
  {
    id: 'internet',
    title: 'Internet va video',
    hint: 'Qidiradi, oʻqiydi, tarjima qiladi',
    items: [
      {
        id: 'qidir',
        icon: '🔍',
        title: 'Internetdan qidirish',
        what: 'Yangi maʼlumotni topadi va manbasini koʻrsatadi.',
        prompt: 'Internetdan qidirib ayt: ',
        needs: 'gemini',
      },
      {
        id: 'videotop',
        icon: '📺',
        title: 'Video topish',
        what: 'YouTube dan mavzuga mos video topadi va chatda ochadi.',
        prompt: 'Menga «» boʻyicha video topib ber.',
        needs: 'gemini',
      },
      {
        id: 'videoquq',
        icon: '💬',
        title: 'Videoni tarjima qilish',
        what: 'Videoni koʻrib mazmunini yozadi, subtitrini oʻzbekchaga oʻgiradi.',
        prompt: 'Bu videoni koʻrib, oʻzbekcha tushuntirib ber: ',
        needs: 'gemini',
      },
      {
        id: 'sayt',
        icon: '🌐',
        title: 'Saytni ochish',
        what: 'Ilovaning oʻz brauzerida sahifani ochadi va oʻqiydi.',
        prompt: 'Bu saytni ochib, asosiy fikrlarini ayt: ',
      },
      {
        id: 'joy',
        icon: '📍',
        title: 'Joy va yoʻl',
        what: 'Yaqin joylarni topadi, marshrut tuzadi.',
        prompt: 'Menga yaqin atrofdagi ... ni topib ber.',
      },
    ],
  },
  {
    id: 'tartib',
    title: 'Tartib va vaqt',
    hint: 'Jadval, vazifa, loyiha, avtomatik ish',
    items: [
      {
        id: 'jadval',
        icon: '📅',
        title: 'Dars jadvali',
        what: 'Jadvalga dars qoʻshadi va bugungisini eslatadi.',
        prompt: 'Jadvalimga dars qoʻsh: ',
      },
      {
        id: 'vazifa',
        icon: '✅',
        title: 'Vazifa qoʻshish',
        what: 'Muddati bilan vazifa yozadi va kuzatadi.',
        prompt: 'Vazifa qoʻsh: ',
      },
      {
        id: 'loyiha',
        icon: '📁',
        title: 'Loyihani boʻlaklash',
        what: 'Katta ishni bosqichlarga ajratadi va muddat qoʻyadi.',
        prompt: 'Bu loyihani bosqichlarga ajratib ber: ',
      },
      {
        id: 'avto',
        icon: '🔁',
        title: 'Avtomatik ish',
        what: 'Har kuni belgilangan vaqtda oʻzi bajaradigan topshiriq qoʻyadi.',
        prompt: 'Har kuni ertalab 8:00 da menga ... qilib ber.',
      },
    ],
  },
  {
    id: 'ulanish',
    title: 'Boshqa ilovalar',
    hint: 'Telegram, Notion, webhook va boshqalar',
    items: [
      {
        id: 'telegram',
        icon: '✈️',
        title: 'Telegramga yuborish',
        what: 'Natijani oʻzingizga yoki kanalga tashlaydi.',
        prompt: 'Bugungi rejamni Telegramga yuborib qoʻy.',
        needs: 'ulanish',
      },
      {
        id: 'notion',
        icon: '📓',
        title: 'Notionga yozish',
        what: 'Konspekt yoki vazifani Notion bazasiga qoʻshadi.',
        prompt: 'Shu konspektni Notionga yozib qoʻy.',
        needs: 'ulanish',
      },
      {
        id: 'webhook',
        icon: '🪝',
        title: 'Webhook chaqirish',
        what: 'n8n, Make yoki oʻz serveringizga maʼlumot uzatadi.',
        prompt: 'Bu maʼlumotni webhookka yuborib yubor: ',
        needs: 'ulanish',
      },
      {
        id: 'uy',
        icon: '🏠',
        title: 'Uy qurilmalari',
        what: 'Home Assistant orqali chiroq va qurilmalarni boshqaradi.',
        prompt: 'Mehmonxonadagi chiroqni yoq.',
        needs: 'ulanish',
      },
    ],
  },
  {
    id: 'kod',
    title: 'Daho Code',
    hint: 'Toʻliq dasturchi agent',
    items: [
      {
        id: 'loyihakod',
        icon: '⌨️',
        title: 'Dastur yozish',
        what: 'Koʻp fayldan iborat loyiha yozadi, oʻzi sinaydi va tuzatadi.',
        prompt: 'Menga shunday dastur yozib ber: ',
      },
      {
        id: 'github',
        icon: '🐙',
        title: 'GitHub bilan ishlash',
        what: 'Repo ochadi, kod yuboradi, PR va issue yaratadi.',
        prompt: 'Loyihamni GitHub ga yuborib qoʻy.',
        needs: 'github',
      },
      {
        id: 'nashr',
        icon: '🚀',
        title: 'Saytni nashr qilish',
        what: 'GitHub Pages orqali internetga chiqaradi va havola beradi.',
        prompt: 'Shu saytni internetga chiqarib, havolasini ber.',
        needs: 'github',
      },
      {
        id: 'yordamchi',
        icon: '👥',
        title: 'Yordamchi agentlar',
        what: 'Katta ishni dizayner, dasturchi va tekshiruvchiga boʻlib beradi.',
        prompt: 'Bu ishni yordamchi agentlarga boʻlib bajar: ',
      },
    ],
  },
];

/** Hammasi nechta — «N ta imkoniyat» deb koʻrsatish uchun. */
export function capabilityCount(): number {
  return CAPABILITY_GROUPS.reduce((n, g) => n + g.items.length, 0);
}
