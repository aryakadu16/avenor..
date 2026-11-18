import crypto from 'node:crypto';import {cfg} from '../config.js';import {HttpError} from '../middleware.js';
const key=()=>{const k=Buffer.from(cfg.encKey||'','base64');if(k.length!==32)throw new HttpError(503,'TOKEN_ENC_KEY must be 32 bytes, base64-encoded','NOT_CONFIGURED');return k};
export const enc=t=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv),b=Buffer.concat([c.update(t,'utf8'),c.final()]);return[iv,c.getAuthTag(),b].map(x=>x.toString('base64')).join('.')};
export const dec=s=>{const[iv,tag,b]=s.split('.').map(x=>Buffer.from(x,'base64')),d=crypto.createDecipheriv('aes-256-gcm',key(),iv);d.setAuthTag(tag);return Buffer.concat([d.update(b),d.final()]).toString('utf8')};
