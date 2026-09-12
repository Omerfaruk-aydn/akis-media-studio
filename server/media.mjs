import { spawn } from 'node:child_process';
import { access, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { randomUUID } from 'node:crypto';
import { ApiError, validateUrl, createNetworkProxy, downloadImage, fetchPublicPage } from './security.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const tools = {ytDlp:path.join(root,'server','tools',process.platform === 'win32' ? 'yt-dlp.exe':'yt-dlp'),galleryDl:path.join(root,'server','tools',process.platform === 'win32' ? 'gallery-dl.exe':'gallery-dl'),ffmpeg};
export async function toolStatus() {return Object.fromEntries(await Promise.all(Object.entries(tools).map(async ([key,file])=>{try{await access(file);return [key,true];}catch{return [key,false];}})));}
export function run(executable,args,{signal,onLine,timeout=120000,maxOutput=8*1024*1024,cwd}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted) return reject(new Error('Cancelled'));
    const child = spawn(executable,args,{shell:false,windowsHide:true,cwd,stdio:['ignore','pipe','pipe'],env:{...process.env,NO_PROXY:'',no_proxy:''}});
    let output='', error='', pending='', failure;
    const stop = reason=>{failure ||= reason;child.kill('SIGKILL');};
    const abort = ()=>stop(new Error('Cancelled'));
    const timer = setTimeout(()=>stop(new ApiError(504,'TIMEOUT','İşlem zaman aşımına uğradı.')),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    let stdoutPending='';
    child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>maxOutput)stop(new Error('Output limit'));if(onLine){stdoutPending+=chunk;const lines=stdoutPending.split(/[\r\n]/);stdoutPending=lines.pop().slice(-8192);for(const line of lines)onLine(line);}});
    child.stderr.on('data',chunk=>{error=(error+chunk).slice(-8192);pending+=chunk;const lines=pending.split(/[\r\n]/);pending=lines.pop().slice(-8192);for(const line of lines)onLine?.(line);});
    child.on('error',err=>{failure=err;});
    child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure)reject(failure);else if(code!==0)reject(new ApiError(502,'SOURCE_UNAVAILABLE','İçerik alınamadı. Bağlantı herkese açık olmayabilir veya platform erişimi sınırlıyor olabilir.'));else resolve(output);});
  });
}
const safeThumbnail = value=>{try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}};
const text = (value,fallback='')=>typeof value === 'string'?value.slice(0,300):fallback;
const positive = value=>Number.isFinite(value)&&value>0?value:null;
const common = proxy=>['--ignore-config','--no-cache-dir','--no-playlist','--playlist-end','20','--socket-timeout','20','--retries','1','--fragment-retries','1','--proxy',proxy,'--js-runtimes',`node:${process.execPath}`];
const galleryArgs = proxy=>['--config-ignore','--proxy',proxy,'--http-timeout','20','--retries','1','--range','1-20'];
const decodeHtml = value=>value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x([0-9a-f]+);/gi,(_match,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/&#(\d+);/g,(_match,decimal)=>String.fromCodePoint(Number(decimal))).replace(/&lt;/g,'<').replace(/&gt;/g,'>');
export function instagramPageImage(html) {
  const image=html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1] || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i)?.[1];
  if(!image)return null;
  const imageUrl=decodeHtml(image);
  if(!safeThumbnail(imageUrl))return null;
  const title=decodeHtml(html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] || 'Instagram fotoğrafı');
  return {id:randomUUID(),type:'image',title:text(title,'Instagram fotoğrafı'),thumbnail:imageUrl,formats:[{id:'original',ext:'jpg',height:null,fps:null,hasAudio:false}],imageUrl,imageExt:'jpg'};
}
export function normalizeMetadata(data,url,platform) {
  if(data.is_live || data.live_status==='is_live')throw new ApiError(400,'LIVE_UNSUPPORTED','Canlı yayınlar desteklenmiyor.');
  const entries = data.entries || [data];
  const items=[];
  for(const [entryIndex,entry] of entries.slice(0,20).entries()) {
    if(!entry || entry.is_live)continue;
    const formats=(entry.formats || (entry.url?[entry]:[])).filter(f=>!f.has_drm && /^[a-zA-Z0-9_.-]{1,100}$/.test(String(f.format_id || '')) && f.vcodec !== 'none').map(f=>({id:String(f.format_id),ext:text(f.ext,'mp4'),height:positive(f.height),fps:positive(f.fps),hasAudio:!!f.acodec&&f.acodec!=='none'}));
    if(!formats.length)continue;
    let source=url;
    if(entry.webpage_url) {try{source=validateUrl(entry.webpage_url,platform);}catch{continue;}}
    items.push({id:randomUUID(),type:'video',title:text(entry.title,text(data.title,'Video')),thumbnail:safeThumbnail(entry.thumbnail || data.thumbnail),formats,source,sourceId:String(entry.id || ''),playlistIndex:entryIndex+1,duration:positive(entry.duration),audioAvailable:(entry.formats || []).some(f=>f.acodec&&f.acodec!=='none')||formats.some(f=>f.hasAudio)});
  }
  return {id:randomUUID(),title:text(data.title,'Medya'),author:text(data.uploader || data.channel || data.creator),thumbnail:safeThumbnail(data.thumbnail)||items[0]?.thumbnail||null,duration:positive(data.duration),platform,items};
}
export function selectFormat(item,request) {
  if(item.type==='image') {if(!['jpg','png','original'].includes(request.format))throw new ApiError(400,'FORMAT_UNSUPPORTED','Fotoğraf için JPG, PNG veya orijinal seçin.');return null;}
  if(!['mp4','webm','mp3','m4a','original'].includes(request.format))throw new ApiError(400,'FORMAT_UNSUPPORTED','Video için geçerli bir çıktı biçimi seçin.');
  if(['mp3','m4a'].includes(request.format)) {if(!item.audioAvailable)throw new ApiError(400,'NO_AUDIO','Bu kaynakta ses bulunmuyor.');return 'bestaudio/best';}
  const candidates=item.formats.filter(f=>(request.height===null || f.height===request.height)&&(request.fps===null || (f.fps!==null && Math.round(f.fps)===request.fps))).sort((a,b)=>(b.height||0)-(a.height||0)||(b.fps||0)-(a.fps||0));
  if(!candidates.length)throw new ApiError(400,'QUALITY_UNAVAILABLE','Seçilen çözünürlük/FPS kaynakta bulunmuyor.');
  const chosen=candidates[0];
  return chosen.hasAudio || !item.audioAvailable ? chosen.id : `${chosen.id}+bestaudio/${chosen.id}`;
}
export function createMediaEngine({runner=run,proxyFactory=createNetworkProxy,imageDownloader=downloadImage,status=toolStatus}={}) {
  return {
    status,
    async inspect(url,platform,signal) {
      const available=await status();
      const social= ['instagram','twitter','facebook'].includes(platform);
      if(!available.ytDlp && (!social || !available.galleryDl)) throw new ApiError(503,'TOOLS_MISSING','Araçlar eksik. npm run setup:tools komutunu çalıştırın.');
      const proxy=await proxyFactory();
      try {
        let video, videoError;
        if (available.ytDlp) {
          try {video=normalizeMetadata(JSON.parse(await runner(tools.ytDlp,[...common(proxy.url),'--dump-single-json','--skip-download','--',url],{signal,timeout:70000})),url,platform);}catch(err){videoError=err;}
        }
        if(signal?.aborted)throw new Error('Cancelled');
        if(social && available.galleryDl) {
          try {
            const rows=JSON.parse(await runner(tools.galleryDl,[...galleryArgs(proxy.url),'-j','--',url],{signal,timeout:45000}));
            const galleryError=rows.find(row=>Array.isArray(row)&&row[0]===-1)?.[1]?.message;
            const images=rows.filter(row=>Array.isArray(row)&&row[0]===3 && ['jpg','jpeg','png','webp','gif','avif'].includes(row[2]?.extension)).slice(0,20).map(row=>({id:randomUUID(),type:'image',title:text(row[2].description || row[2].content,'Fotoğraf'),thumbnail:safeThumbnail(row[1]),formats:[{id:'original',ext:row[2].extension,height:positive(row[2].height),fps:null,hasAudio:false}],imageUrl:row[1],imageExt:row[2].extension}));
            if (!images.length && galleryError && platform!=='instagram') throw new ApiError(502,'SOURCE_UNAVAILABLE','Gönderiye erişilemedi. Hesap veya gönderi herkese açık olmayabilir.');
            if(images.length){video ||= {id:randomUUID(),title:images[0].title,author:'',thumbnail:images[0].thumbnail,duration:null,platform,items:[]};video.items.push(...images);video.items=video.items.slice(0,20);}
          } catch(err) {if(signal?.aborted)throw err;if(!video?.items.length && platform!=='instagram')throw videoError || err;}
        }
        if(!video?.items.length && platform==='instagram') {
          try {
            const page=await fetchPublicPage(url,signal);
            const image=instagramPageImage(page);
            if(image)video={id:randomUUID(),title:image.title,author:'',thumbnail:image.thumbnail,duration:null,platform,items:[image]};
          } catch(err) {if(signal?.aborted)throw err;}
        }
        if(!video?.items.length)throw videoError || new ApiError(422,'NO_MEDIA','Desteklenen medya bulunamadı.');
        return video;
      } finally {proxy.close();}
    },
    async download(item,request,dir,signal,update) {
      const selection=selectFormat(item,request);
      let source;
      if(item.type==='image') {
        source=path.join(dir,`source.${item.imageExt}`);
        await imageDownloader(item.imageUrl,source,signal);
      } else {
        const proxy=await proxyFactory();
        try {
          const args=[...common(proxy.url),'--no-part','--restrict-filenames','--max-filesize','512M','--playlist-items',String(item.playlistIndex||1),'--merge-output-format','mkv','--ffmpeg-location',tools.ffmpeg,'--newline','--progress','--progress-template','download:AKIS:%(progress._percent_str)s','-f',selection,'-o',path.join(dir,'source.%(ext)s'),'--',item.source];
          await runner(tools.ytDlp,args,{signal,timeout:12*60*1000,onLine:line=>{const m=line.match(/AKIS:\s*([\d.]+)%/);if(m)update('downloading',Math.min(80,Number(m[1])*.8));}});
          const files=(await readdir(dir)).filter(f=>/^source\.[a-z0-9]+$/i.test(f));
          if(files.length!==1)throw new Error('Missing source');
          source=path.join(dir,files[0]);
        } finally {proxy.close();}
      }
      if(request.format==='original')return source;
      update('processing',85);
      const target=path.join(dir,`akis.${request.format}`);
      const options=item.type==='image'?['-frames:v','1']:request.format==='mp3'?['-vn','-c:a','libmp3lame','-b:a',`${request.bitrate}k`]:request.format==='m4a'?['-vn','-c:a','aac','-b:a',`${request.bitrate}k`]:request.format==='webm'?['-map','0:v:0','-map','0:a:0?','-c:v','libvpx-vp9','-crf','32','-b:v','0','-c:a','libopus']:['-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart'];
      await runner(tools.ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y','-protocol_whitelist','file,pipe','-i',source,...options,'-threads','2','-fs',String(768*1024*1024),target],{signal,timeout:15*60*1000});
      if((await stat(target)).size>=768*1024*1024)throw new Error('Output limit');
      await unlink(source);
      return target;
    }
  };
}
export function publicMedia(media) {
  return {id:media.id,title:media.title,author:media.author,thumbnail:media.thumbnail,duration:media.duration,platform:media.platform,items:media.items.map(({id,type,title,thumbnail,formats,audioAvailable})=>({id,type,title,thumbnail,formats,audioAvailable:!!audioAvailable}))};
}
