import {createApp} from './app.js';import {cfg} from './config.js';
createApp().listen(cfg.port,()=>console.log(`AVENOR API on :${cfg.port} | supabase:${!!(cfg.sbUrl&&cfg.sbAnon)} openai:${!!cfg.oaKey}`));
