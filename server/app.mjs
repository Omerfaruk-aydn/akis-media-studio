import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import { ApiError, validateUrl } from './security.mjs';
import { createMediaEngine, publicMedia, selectFormat, root } from './media.mjs';

const inspectSchema=z.object({url:z.string().min(1).max(2048),platform:z.enum(['youtube','instagram','twitter','facebook'])}).strict();
const downloadSchema=z.object({mediaId:z.uuid(),itemId:z.uuid(),format:z.enum(['mp4','webm','mp3','m4a','jpg','png','original']),height:z.number().int().min(1).max(8640).nullable().default(null),fps:z.number().int().min(1).max(240).nullable().default(null),bitrate:z.union([z.literal(128),z.literal(192),z.literal(320)]).default(192)}).strict();
const terminal=job=>['completed','failed'].includes(job.status);
const publicJob=job=>({id:job.id,status:job.status,progress:job.progress,title:job.title,...(job.error?{error:job.error}:{}),...(job.status==='completed'?{downloadUrl:`/api/jobs/${job.id}/file`,filename:job.filename}:{})});
async function directorySize(dir) {
  let total=0;
  for(const entry of await readdir(dir,{withFileTypes:true})) {const file=path.join(dir,entry.name);if(entry.isDirectory())total+=await directorySize(file);else if(entry.isFile())total+=(await stat(file)).size;}
  return total;
}
export async function createApp({engine=createMediaEngine(),dataDir=path.join(root,'server','data'),ttl=60*60*1000,maxJobs=12,maxInspections=3,maxMedia=100,jobTimeout=28*60*1000,allowedOrigins=['http://127.0.0.1:5173','http://localhost:5173'],logger=console}={}) {
  await mkdir(dataDir,{recursive:true});
  for(const entry of await readdir(dataDir,{withFileTypes:true}))if(entry.isDirectory()&&/^job-[0-9a-f-]{36}$/.test(entry.name))await rm(path.join(dataDir,entry.name),{recursive:true,force:true});
  const app=express();app.set('trust proxy',1);const media=new Map();const jobs=new Map();const queue=[];const inspections=new Set();let active=0,closed=false,cleaning=false;
  app.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy:{directives:{'img-src':["'self'",'https:','data:'],'font-src':["'self'",'data:'],'script-src':["'self'"],'upgrade-insecure-requests':null}},crossOriginResourcePolicy:{policy:'cross-origin'}}));
  app.use((req,res,next)=>{
    let host;try{host=new URL(`http://${req.headers.host}`).hostname;}catch{}
    if(!['127.0.0.1','localhost','[::1]'].includes(host) && !host.endsWith('.onrender.com') && !host.endsWith('.up.railway.app'))return res.status(403).json({code:'HOST_FORBIDDEN',error:'Yalnızca yerel erişim desteklenir.'});
    if(req.path.startsWith('/api'))res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin=req.headers.origin;
      if(req.headers['sec-fetch-site']==='cross-site'||(origin && origin!==`http://${req.headers.host}` && !allowedOrigins.includes(origin)))return res.status(403).json({code:'ORIGIN_FORBIDDEN',error:'Bu kaynaktan istek kabul edilmiyor.'});
      if(!req.is('application/json'))return res.status(415).json({code:'JSON_REQUIRED',error:'JSON gövdesi gerekli.'});
    }
    next();
  });
  app.use('/api',rateLimit({windowMs:60000,limit:240,standardHeaders:'draft-8',legacyHeaders:false,message:{code:'RATE_LIMIT',error:'Çok fazla istek. Bir dakika bekleyin.'}}));
  app.use(express.json({limit:'8kb',strict:true}));
  async function cleanup() {
    if(cleaning)return;cleaning=true;
    try {
      const now=Date.now();
      for(const [id,m] of media)if(now-m.created>ttl)media.delete(id);
      for(const [id,j] of jobs)if(terminal(j)&&!j.readers&&now-j.updated>ttl){await rm(j.dir,{recursive:true,force:true});jobs.delete(id);}
    } finally {cleaning=false;}
  }
  const cleanupTimer=setInterval(()=>cleanup().catch(()=>logger.error('cleanup_failed')),60000);cleanupTimer.unref();
  function pump() {
    while(!closed && active<2 && queue.length) {
      const job=queue.shift();active++;
      job.task=(async()=>{
        const controller=new AbortController();job.controller=controller;
        const timeout=setTimeout(()=>controller.abort(),jobTimeout);
        let monitoring=false;
        const monitor=setInterval(async()=>{
          if(monitoring)return;monitoring=true;
          try {if(await directorySize(job.dir)>1536*1024*1024)controller.abort();}catch {controller.abort();}finally{monitoring=false;}
        },1000);
        try {
          await mkdir(job.dir,{recursive:true});
          const disk=await statfs(dataDir);if(Number(disk.bavail)*Number(disk.bsize)<2*1024**3)throw new ApiError(507,'DISK_FULL','Diskte en az 2 GB boş alan gerekli.');
          job.status='downloading';
          const file=await engine.download(job.item,job.request,job.dir,controller.signal,(status,progress)=>{job.status=status;job.progress=Math.max(job.progress,Math.min(99,Math.max(0,progress)));});
          if(controller.signal.aborted)throw new Error('Cancelled');
          if(path.dirname(path.resolve(file))!==path.resolve(job.dir))throw new Error('Invalid output path');
          const info=await stat(file);if(!info.isFile()||!info.size||info.size>768*1024*1024)throw new Error('Invalid output');
          job.file=file;job.filename=`akis-${job.id.slice(0,8)}${path.extname(file)}`;job.progress=100;job.status='completed';
        } catch(err) {
          job.status='failed';job.error=controller.signal.aborted?'İşlem süre veya disk sınırını aştı ya da sunucu kapatıldı.':err instanceof ApiError?err.message:'İndirme/dönüştürme tamamlanamadı. Bağlantıyı yeniden analiz edin ve tekrar deneyin.';
          logger.error('download_failed',{id:job.id,code:err.code||'PROCESS_FAILED'});
          try{await rm(job.dir,{recursive:true,force:true});}catch{logger.error('job_cleanup_failed',{id:job.id});}
        } finally {clearTimeout(timeout);clearInterval(monitor);job.updated=Date.now();job.item=null;job.request=null;active--;pump();}
      })();
    }
  }
  app.get('/api/health',async(_req,res)=>{const tools=await engine.status();res.json({ready:!closed&&tools.ytDlp&&tools.ffmpeg,tools});});
  app.post('/api/inspect',async(req,res)=>{
    const parsed=inspectSchema.safeParse(req.body);if(!parsed.success)throw new ApiError(400,'INVALID_INPUT','Bağlantı ve platform alanlarını kontrol edin.');
    const url=validateUrl(parsed.data.url,parsed.data.platform);
    await cleanup();
    if(closed||inspections.size>=maxInspections)throw new ApiError(429,'BUSY','Analiz kapasitesi dolu. Biraz sonra tekrar deneyin.');
    if(media.size+inspections.size>=maxMedia)throw new ApiError(429,'CAPACITY','Analiz sınırına ulaşıldı. Eski analizlerin süresi dolmalı.');
    const controller=new AbortController();inspections.add(controller);
    const timer=setTimeout(()=>controller.abort(),120000);
    const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnected);
    try {const result=await engine.inspect(url,parsed.data.platform,controller.signal);if(controller.signal.aborted)throw new ApiError(504,'TIMEOUT','Analiz zaman aşımına uğradı.');result.created=Date.now();media.set(result.id,result);res.json(publicMedia(result));}
    finally {clearTimeout(timer);inspections.delete(controller);res.off('close',disconnected);}
  });
  app.post('/api/download',async(req,res)=>{
    const parsed=downloadSchema.safeParse(req.body);if(!parsed.success)throw new ApiError(400,'INVALID_INPUT','İndirme seçeneklerini kontrol edin.');
    const request=parsed.data;const record=media.get(request.mediaId);
    if(!record||Date.now()-record.created>ttl)throw new ApiError(404,'MEDIA_EXPIRED','Analizin süresi dolmuş. Bağlantıyı yeniden analiz edin.');
    const item=record.items.find(i=>i.id===request.itemId);if(!item)throw new ApiError(404,'ITEM_NOT_FOUND','Medya öğesi bulunamadı.');
    selectFormat(item,request);
    const key=JSON.stringify(request);
    const duplicate=[...jobs.values()].find(j=>j.key===key&&j.status!=='failed'&&Date.now()-j.updated<=ttl);
    if(duplicate)return res.status(202).json({id:duplicate.id,status:duplicate.status});
    if(closed||jobs.size>=maxJobs)throw new ApiError(429,'CAPACITY','İş sınırına ulaşıldı. Eski işlerin süresi dolmalı.');
    const id=randomUUID();const job={id,key,status:'queued',progress:0,title:item.title,dir:path.join(dataDir,`job-${id}`),item,request,updated:Date.now(),readers:0};
    jobs.set(id,job);queue.push(job);res.status(202).json({id,status:'queued'});setImmediate(pump);
  });
  app.get('/api/jobs/:id',(req,res)=>{const job=jobs.get(req.params.id);if(!job)throw new ApiError(404,'JOB_NOT_FOUND','İş bulunamadı veya süresi doldu.');res.json(publicJob(job));});
  app.get('/api/jobs/:id/file',(req,res,next)=>{
    const job=jobs.get(req.params.id);if(!job)throw new ApiError(404,'JOB_NOT_FOUND','İş bulunamadı veya süresi doldu.');
    if(job.status!=='completed')throw new ApiError(409,'NOT_READY','Dosya henüz hazır değil.');
    job.readers++;res.download(job.file,job.filename,{dotfiles:'deny'},err=>{job.readers--;if(err&&!res.headersSent)next(new ApiError(410,'FILE_GONE','Dosya artık mevcut değil.'));else if(err)res.destroy();});
  });
  app.use('/api',(_req,_res,next)=>next(new ApiError(404,'NOT_FOUND','API adresi bulunamadı.')));
  app.use(express.static(path.join(root,'dist'),{index:'index.html'}));
  app.get('/{*path}',(_req,res)=>res.sendFile(path.join(root,'dist','index.html'),err=>{if(err&&!res.headersSent)res.status(404).send('Arayüz hazır değil. npm run build komutunu çalıştırın.');}));
  app.use((err,_req,res,_next)=>{
    if(res.headersSent)return res.destroy();
    const status=err instanceof ApiError?err.status:err.type==='entity.too.large'?413:err instanceof SyntaxError?400:502;
    if(!(err instanceof ApiError))logger.error('request_failed',{code:err.code||err.type||'INTERNAL'});
    res.status(status).json({code:err instanceof ApiError?err.code:status===413?'BODY_TOO_LARGE':status===400?'INVALID_JSON':'SOURCE_UNAVAILABLE',error:err instanceof ApiError?err.message:status===413?'İstek gövdesi çok büyük.':status===400?'Geçersiz JSON.':'İçerik alınamadı. Platform geçici olarak erişimi engelliyor olabilir.'});
  });
  async function close() {closed=true;clearInterval(cleanupTimer);for(const controller of inspections)controller.abort();for(const job of queue.splice(0)){job.status='failed';job.error='Sunucu kapatıldı.';}for(const job of jobs.values())job.controller?.abort();await Promise.allSettled([...jobs.values()].map(j=>j.task).filter(Boolean));}
  return {app,close,cleanup,jobs};
}
