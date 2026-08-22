/** Sozlamalar — hammasi muhit oʻzgaruvchilaridan. */
export const env = {
  port: Number(process.env.PORT || 8080),

  supabaseUrl: process.env.SUPABASE_URL || '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  anonKey: process.env.SUPABASE_ANON_KEY || '',
  // Chrome Web Store dagi manzil — joylangach shu yerga yoziladi.
  storeUrl: process.env.EXTENSION_STORE_URL || '',

  geminiKey: process.env.GEMINI_API_KEY || '',
  /*
   * OpenRouter kaliti — bitta kalit bilan 300+ model (Kimi, Qwen,
   * DeepSeek, GPT, Claude, Llama). Railway muhit oʻzgaruvchisiga
   * qoʻyiladi va SHU YERDAN chiqmaydi: brauzerga ham, bazaga ham emas.
   */
  openrouterKey: process.env.OPENROUTER_API_KEY || '',

  /** Worker chaqiruvlari va terminal uchun umumiy maxfiy soʻz */
  workerSecret: process.env.WORKER_SECRET || '',

  /** Navbatni necha soniyada bir tekshirish */
  pollSeconds: Number(process.env.POLL_SECONDS || 10),
  /** Bir martada nechta vazifa olinadi */
  batchSize: Number(process.env.BATCH_SIZE || 3),

  /** Terminal yoqilganmi (xavfsizlik uchun standart holda oʻchiq) */
  shellEnabled: process.env.ENABLE_SHELL === '1',
  shellTimeoutMs: Number(process.env.SHELL_TIMEOUT_MS || 120000),
  workDir: process.env.WORK_DIR || '/tmp/daho-work',
};

export function missing() {
  const gaps = [];
  if (!env.supabaseUrl) gaps.push('SUPABASE_URL');
  if (!env.serviceKey) gaps.push('SUPABASE_SERVICE_ROLE_KEY');
  // Kamida bitta AI provayderi kerak — ikkalasi ham boʻlishi shart emas.
  if (!env.geminiKey && !env.openrouterKey) gaps.push('GEMINI_API_KEY yoki OPENROUTER_API_KEY');
  if (!env.workerSecret) gaps.push('WORKER_SECRET');
  return gaps;
}
