import {createClient} from '@supabase/supabase-js';import {cfg} from '../config.js';
let o=null;export const __setSvc=x=>{o=x};
// Service-role client: used ONLY for gmail_connections / oauth_states, always filtered by the verified user id. Never sent to the browser.
export const getSvc=()=>o||createClient(cfg.sbUrl,cfg.sbSvc,{auth:{persistSession:false,autoRefreshToken:false}});
