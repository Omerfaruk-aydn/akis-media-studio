import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createWriteStream } from 'node:fs';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const domains = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'],
  instagram: ['instagram.com', 'www.instagram.com'],
  twitter: ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'],
};
export function validateUrl(value, platform) {
  let u;
  try { u = new URL(value); } catch { throw new ApiError(400, 'INVALID_URL', 'Geçerli bir bağlantı girin.'); }
  const authority = value.match(/^https?:\/\/([^/\\?#]+)/i)?.[1];
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port || !authority || authority.includes(':') || authority.includes('@') || value.includes('\\') || !domains[platform]?.includes(u.hostname)) throw new ApiError(400, 'INVALID_URL', 'Bağlantı seçilen platforma ait olmalı; kullanıcı bilgisi ve port içeremez.');
  u.protocol = 'https:'; u.hash = '';
  if (u.pathname === '/' && !u.searchParams.has('v')) throw new ApiError(400, 'INVALID_URL', 'Profil yerine bir gönderi veya video bağlantısı girin.');
  return u.href;
}
export function publicIP(address) {
  if (net.isIPv4(address)) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0));
  }
  return net.isIPv6(address) && /^[23][0-9a-f]{3}:/i.test(address) && !/^(2001:(?:0{0,4}:|0?[01][0-9a-f]{2}:|db8:)|2002:|3fff:)/i.test(address);
}
export async function publicAddress(host) {
  const entries = await dns.lookup(host, {all:true});
  if (!entries.length || entries.some(x => !publicIP(x.address))) throw new Error('Blocked network destination');
  return entries.find(entry=>entry.family===4) || entries[0];
}
export async function createNetworkProxy() {
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url);
      if (u.protocol !== 'http:' || u.username || u.password || (u.port && u.port !== '80')) throw new Error('Blocked');
      const addr = await publicAddress(u.hostname);
      const upstream = http.request(u, {method:req.method, headers:{host:u.host}, lookup:(_h,_o,cb)=>cb(null,addr.address,addr.family), timeout:20000}, r => {res.writeHead(r.statusCode); r.pipe(res);});
      upstream.on('timeout',()=>upstream.destroy()); upstream.on('error',()=>res.destroy());
      req.on('aborted',()=>upstream.destroy()); req.pipe(upstream);
    } catch {res.writeHead(403);res.end();}
  });
  server.on('connect', async (req, socket, head) => {
    try {
      const u = new URL(`https://${req.url}`);
      if (u.port || u.username || u.password) throw new Error('Blocked');
      const addr = await publicAddress(u.hostname);
      if (socket.destroyed) return;
      const upstream = net.connect(443, addr.address);
      sockets.add(upstream); upstream.on('close',()=>sockets.delete(upstream));
      upstream.setTimeout(30000,()=>upstream.destroy());
      upstream.on('error',()=>socket.destroy()); socket.on('error',()=>upstream.destroy()); socket.on('close',()=>upstream.destroy());
      upstream.on('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if(head.length) upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
    } catch {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
  });
  server.on('connection', s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`, close:()=>{for(const s of sockets)s.destroy();server.close();}};
}
export async function fetchPublicPage(url, signal, maxBytes = 2 * 1024 * 1024, redirects = 0) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || redirects > 5) throw new Error('Invalid page URL');
  const addr = await publicAddress(u.hostname);
  const response = await new Promise((resolve,reject)=>{
    const lookup=(_host,options,callback)=>options?.all?callback(null,[addr]):callback(null,addr.address,addr.family);
    const req = https.get(u,{signal,lookup,timeout:20000,headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)','Accept':'text/html,application/xhtml+xml'}},resolve);
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Timeout')));
  });
  if ([301,302,303,307,308].includes(response.statusCode)) {response.resume();return fetchPublicPage(new URL(response.headers.location,u).href,signal,maxBytes,redirects+1);}
  if(response.statusCode !== 200 || !/^text\/html/i.test(response.headers['content-type'] || '')) {response.destroy();throw new Error('Page unavailable');}
  const chunks=[];let bytes=0;
  for await (const chunk of response) {bytes+=chunk.length;if(bytes>maxBytes){response.destroy();throw new Error('Page too large');}chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}

export async function downloadImage(url, file, signal, maxBytes = 100 * 1024 * 1024, redirects = 0) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || redirects > 5) throw new Error('Invalid image URL');
  const addr = await publicAddress(u.hostname);
  const response = await new Promise((resolve,reject)=>{
    const lookup=(_host,options,callback)=>options?.all?callback(null,[addr]):callback(null,addr.address,addr.family);
    const req = https.get(u,{signal,lookup,timeout:20000,headers:{'User-Agent':'Mozilla/5.0'}},resolve);
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Timeout')));
  });
  if ([301,302,303,307,308].includes(response.statusCode)) {response.resume();return downloadImage(new URL(response.headers.location,u).href,file,signal,maxBytes,redirects+1);}
  if(response.statusCode !== 200 || !/^image\/(jpeg|png|webp|gif|avif)/i.test(response.headers['content-type'] || '')) {response.destroy();throw new Error('Image unavailable');}
  let bytes = 0;
  const limiter = new Transform({transform(chunk,_enc,cb){bytes += chunk.length; cb(bytes>maxBytes?new Error('Image too large'):null,chunk);}});
  await pipeline(response,limiter,createWriteStream(file,{flags:'wx'}),{signal});
}
