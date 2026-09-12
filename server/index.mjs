import { createApp } from './app.mjs';

const port=Number(process.env.PORT || 8080);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 1–65535 aralığında olmalı.');
const allowedOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean);
const host=process.env.HOST || (allowedOrigins.length ? '0.0.0.0' : '127.0.0.1');
const {app,close}=await createApp({allowedOrigins});
const server=app.listen(port,host,()=>console.info(`Akış: http://${host}:${port}`));
server.requestTimeout=130000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;server.close();await close();server.closeAllConnections();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
server.on('error',async err=>{console.error('Sunucu başlatılamadı:',err.code);await close();process.exitCode=1;});
