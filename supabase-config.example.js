// DRAGONS SMP — Configuración pública de Supabase (NO contiene secretos).
// 1. Copia este archivo como "supabase-config.js" en la misma carpeta que index.html.
// 2. Rellena con los valores de tu proyecto Supabase (Dashboard → Project Settings → API).
// 3. "supabase-config.js" está pensado para NO subirse con valores reales si usas git.
// La ANON KEY es pública por diseño y vive en el frontend. El CLIENT SECRET de Discord
// se configura SOLO en el dashboard de Supabase (Authentication → Providers → Discord),
// nunca aquí.

window.DRAGONS_SMP_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
