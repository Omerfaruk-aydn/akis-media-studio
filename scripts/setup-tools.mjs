import { mkdir, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory=fileURLToPath(new URL('../server/tools/',import.meta.url));
async function get(url,max=100*1024*1024,attempt=0) {
  const response=await fetch(url,{signal:AbortSignal.timeout(180000),headers:{'User-Agent':'Akis-tool-setup','Accept':'*/*'}});
  if([429,502,503,504].includes(response.status)&&attempt<2){await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));return get(url,max,attempt+1);}
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>max)throw new Error('İndirme boyut sınırı aşıldı.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function install(repo,api,name,target,checksum) {
  let release;
  try {release=JSON.parse((await get(api,2*1024*1024)).toString());}
  catch(err) {
    if(repo!=='mikf/gallery-dl')throw err;
    console.warn('Codeberg API erişilemiyor; doğrulanmış resmî v1.32.12 yayın adresi deneniyor.');
    release={tag_name:'v1.32.12',assets:[name,checksum].map(asset=>({name:asset,browser_download_url:`https://codeberg.org/mikf/gallery-dl/releases/download/v1.32.12/${asset}`}))};
  }
  const asset=release.assets.find(a=>a.name===name);const sums=release.assets.find(a=>a.name===checksum);
  if(!asset||!sums)throw new Error(`${repo}: bağımsız yürütülebilir veya sağlama toplamı bulunamadı.`);
  for(const assetUrl of [asset.browser_download_url,sums.browser_download_url]) {const u=new URL(assetUrl);if(u.protocol!=='https:'||!['github.com','codeberg.org'].includes(u.hostname)||!u.pathname.startsWith(`/${repo}/releases/download/`))throw new Error('Beklenmeyen yayın kaynağı.');}
  const manifest=(await get(sums.browser_download_url,1024*1024)).toString();
  const hash=manifest.split(/\r?\n/).map(line=>line.trim().split(/\s+\*?/)).find(parts=>parts[1]===name)?.[0];
  if(!/^[a-f0-9]{64}$/i.test(hash||''))throw new Error('SHA256 bulunamadı.');
  const binary=await get(asset.browser_download_url);
  if(createHash('sha256').update(binary).digest('hex')!==hash.toLowerCase())throw new Error('SHA256 doğrulaması başarısız.');
  const destination=path.join(directory,target);const temp=`${destination}.${randomUUID()}.tmp`;
  try {await writeFile(temp,binary,{flag:'wx'});if(process.platform!=='win32')await chmod(temp,0o755);await rename(temp,destination);}finally{await rm(temp,{force:true});}
  const check=spawnSync(destination,['--version'],{shell:false,windowsHide:true,timeout:15000,encoding:'utf8'});
  if(check.error||check.status!==0)throw new Error(`${name} çalıştırılamadı.`);
  console.info(`${name}: ${check.stdout.trim()} — SHA256 doğrulandı (${release.tag_name})`);
}
await mkdir(directory,{recursive:true});
try {
  const win=process.platform==='win32';
  const yt=win?(process.arch==='arm64'?'yt-dlp_arm64.exe':'yt-dlp.exe'):process.platform==='darwin'?'yt-dlp_macos':process.arch==='arm64'?'yt-dlp_linux_aarch64':'yt-dlp_linux';
  await install('yt-dlp/yt-dlp','https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',yt,win?'yt-dlp.exe':'yt-dlp','SHA2-256SUMS');
  if(win||process.platform==='linux'&&process.arch==='x64')await install('mikf/gallery-dl','https://codeberg.org/api/v1/repos/mikf/gallery-dl/releases/latest',win?'gallery-dl.exe':'gallery-dl.bin',win?'gallery-dl.exe':'gallery-dl','SHA256SUMS');
  else console.warn('gallery-dl bağımsız araç bu işletim sistemi için otomatik kurulmadı. Video işlevleri kullanılabilir.');
  const {default:ffmpeg}=await import('ffmpeg-static');
  const check=spawnSync(ffmpeg,['-version'],{shell:false,windowsHide:true,timeout:15000,encoding:'utf8'});
  if(check.error||check.status!==0)throw new Error('FFmpeg eksik. npm install komutunu yeniden çalıştırın.');
  console.info(check.stdout.split('\n')[0]);
} catch(err) {console.error(`Araç kurulumu başarısız: ${err.message}`);process.exitCode=1;}
