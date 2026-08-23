/**
 * Ayni damda qaysi guruh ichida ishlayapmiz.
 *
 * Guruh loyihasi ochilganda shu yerga uning id si yoziladi va har bir
 * AI soʻrovi bilan `X-Daho-Group` sarlavhasida ketadi. Server uni
 * `charge_usage` ga uzatadi: guruh hamyonida kredit boʻlsa avval
 * shundan yechiladi.
 *
 * XAVFSIZLIK: sarlavhaga ishonilmaydi. Bazadagi `group_charge`
 * chaqiruvchi haqiqatan oʻsha guruh aʼzosi ekanini tekshiradi —
 * boshqa guruhning id sini yozib qoʻygan odam hech nima yecha
 * olmaydi, soʻrov oddiygina oʻz kreditidan toʻlanadi.
 */

let joriy: string | null = null;

export function setActiveGroup(id: string | null): void {
  joriy = id;
}

export function activeGroup(): string | null {
  return joriy;
}
