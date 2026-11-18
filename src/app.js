import express from 'express';import cors from 'cors';import helmet from 'helmet';import rateLimit from 'express-rate-limit';
import {cfg} from './config.js';import {HttpError,notFound,errors} from './middleware.js';import routes from './routes/index.js';
export function createApp(){const app=express();app.disable('x-powered-by');if(process.env.TRUST_PROXY)app.set('trust proxy',1);
 app.use(helmet());
 app.use(cors({origin:(o,cb)=>!o||cfg.origins.includes(o)?cb(null,true):cb(new HttpError(403,'Origin not allowed','CORS')),methods:['GET','POST','PATCH','PUT','DELETE'],allowedHeaders:['Authorization','Content-Type']}));
 app.use((q,s,n)=>{const t=Date.now();s.on('finish',()=>console.log(`${q.method} ${q.path} ${s.statusCode} ${Date.now()-t}ms`));n()}); // no headers, query or body logged
 app.use(rateLimit({windowMs:15*60000,limit:600,standardHeaders:true,legacyHeaders:false,message:{error:{message:'Too many requests',code:'RATE_LIMIT'}}}));
 app.use(express.json({limit:'100kb'}));app.use('/api',routes);app.use(notFound);app.use(errors);return app}
