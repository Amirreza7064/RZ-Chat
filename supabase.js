const SUPABASE_URL = "https://iudtkdpiuxlgfrimernz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_H7_insLodA4FKW6UsF45SA_G8Pu5hVo";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { sb };
