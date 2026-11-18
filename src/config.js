import 'dotenv/config';
export const cfg={port:+process.env.PORT||4000,origins:(process.env.ALLOWED_ORIGINS||'http://localhost:5173').split(',').map(s=>s.trim()).filter(Boolean),
sbUrl:process.env.SUPABASE_URL,sbAnon:process.env.SUPABASE_ANON_KEY,oaKey:process.env.OPENAI_API_KEY,oaModel:process.env.OPENAI_MODEL||'gpt-4o-mini'};
