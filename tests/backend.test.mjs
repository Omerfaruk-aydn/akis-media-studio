import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { createApp } from '../server/app.mjs';
import { validateUrl, publicIP } from '../server/security.mjs';
import { createMediaEngine, normalizeMetadata, selectFormat, run } from '../server/media.mjs';

const metadata={id:'test',title:'Örnek video',uploader:'Yazar',duration:12,thumbnail:'https://i.ytimg.com/vi/test/default.jpg',formats:[{format_id:'137',ext:'mp4',height:1080,fps:60,vcodec:'h264',acodec:'none'},{format_id:'18',ext:'mp4',height:360,fps:30,vcodec:'h264',acodec:'aac'},{format_id:'140',ext:'m4a',vcodec:'none',acodec:'aac'}]};
const url='https://www.youtube.com/watch?v=abcdefghijk';
function record(){return normalizeMetadata(metadata,url,'youtube');}
async function fixture(t,overrides={}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'akis-test-'));
  const engine={status:async()=>({ytDlp:true,galleryDl:true,ffmpeg:true}),inspect:async()=>record(),download:async(_item,_request,dir,_signal,update)=>{update('processing',90);const file=path.join(dir,'akis.mp4');await writeFile(file,'video');return file;},...overrides};
  const instance=await createApp({engine,dataDir,logger:{error(){}}});
  const server=instance.app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await instance.close();await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
  const post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(body)});
  return {base,post,...instance};
}
async function complete(base,id){for(let n=0;n<100;n++){const value=await(await fetch(`${base}/api/jobs/${id}`)).json();if(['completed','failed'].includes(value.status))return value;await new Promise(resolve=>setImmediate(resolve));}throw new Error('Job did not finish');}
test('strict platform URL allowlist rejects hostile authorities',()=>{
  for(const invalid of ['http://127.0.0.1/x','http://[::1]/x','https://youtube.com.evil.test/x','https://evil.test/?youtube.com','https://user@youtube.com/x','https://youtube.com:443/x','https://youtube.com:8080/x','file:///x','https://youtube.com./x','https://youtube.com\\@evil.test/x'])assert.throws(()=>validateUrl(invalid,'youtube'));
  assert.throws(()=>validateUrl(url,'instagram'));
  assert.equal(validateUrl('http://youtu.be/abcdefghijk#x','youtube'),'https://youtu.be/abcdefghijk');
});
test('network egress rejects private and mapped addresses',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1'])assert.equal(publicIP(ip),false,ip);
  assert.equal(publicIP('8.8.8.8'),true);assert.equal(publicIP('2606:4700:4700::1111'),true);assert.equal(publicIP('2001:4860:482a:400::'),true);assert.equal(publicIP('2001:db8::1'),false);
});
test('quality maps to source IDs without upscaling or FPS synthesis',()=>{
  const item=record().items[0];
  assert.equal(selectFormat(item,{format:'mp4',height:1080,fps:60}),'137+bestaudio/137');
  assert.equal(selectFormat(item,{format:'mp4',height:360,fps:30}),'18');
  assert.throws(()=>selectFormat(item,{format:'mp4',height:2160,fps:60}));
  assert.throws(()=>selectFormat(item,{format:'mp4',height:360,fps:60}));
  assert.equal(selectFormat(item,{format:'mp3'}),'bestaudio/best');
});
test('health, inspect, job, attachment contracts and duplicate request coalescing',async t=>{
  const {base,post}=await fixture(t);
  assert.deepEqual(await(await fetch(base+'/api/health')).json(),{ready:true,tools:{ytDlp:true,galleryDl:true,ffmpeg:true}});
  const inspected=await post('/api/inspect',{url,platform:'youtube'});assert.equal(inspected.status,200);const media=await inspected.json();
  assert.deepEqual(Object.keys(media).sort(),['author','duration','id','items','platform','thumbnail','title']);
  assert.equal(media.items[0].source,undefined);assert.equal(media.items[0].formats.length,2);
  const body={mediaId:media.id,itemId:media.items[0].id,format:'mp4',height:1080,fps:60,bitrate:192};
  const responses=await Promise.all([post('/api/download',body),post('/api/download',body)]);
  assert.equal(responses[0].status,202);const a=await responses[0].json(),b=await responses[1].json();assert.equal(a.id,b.id);
  const job=await complete(base,a.id);assert.equal(job.status,'completed');assert.equal(job.progress,100);
  const file=await fetch(base+job.downloadUrl);assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/attachment/);assert.equal(await file.text(),'video');
});
test('HTTP mutation rejects cross-origin, malicious host, invalid JSON, oversized bodies, unknown fields and unavailable quality',async t=>{
  const {base,post}=await fixture(t);
  assert.equal((await post('/api/inspect',{url,platform:'youtube'},{Origin:'https://evil.example'})).status,403);
  const hostileHostStatus=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/health',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(hostileHostStatus,403);
  assert.equal((await post('/api/inspect',{url,platform:'youtube','exec':'bad'})).status,400);
  assert.equal((await post('/api/inspect',{url:'x'.repeat(9000),platform:'youtube'})).status,413);
  assert.equal((await fetch(base+'/api/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await fetch(base+'/api/inspect',{method:'POST',body:'x'})).status,415);
  const media=await(await post('/api/inspect',{url,platform:'youtube'})).json();
  assert.equal((await post('/api/download',{mediaId:media.id,itemId:media.items[0].id,format:'mp4',height:4320,fps:60,bitrate:192})).status,400);
  assert.equal((await fetch(base+'/api/jobs/not-an-id/file')).status,404);
});
test('dependency errors become safe failed jobs without leaked stderr',async t=>{
  const {base,post}=await fixture(t,{download:async()=>{throw new Error('secret-cookie=abc D:/private/path');}});
  const media=await(await post('/api/inspect',{url,platform:'youtube'})).json();
  const job=await(await post('/api/download',{mediaId:media.id,itemId:media.items[0].id,format:'mp4',height:null,fps:null,bitrate:128})).json();
  const result=await complete(base,job.id);assert.equal(result.status,'failed');assert.doesNotMatch(result.error,/secret|private/);
  assert.equal((await fetch(base+`/api/jobs/${job.id}/file`)).status,409);
});
test('mock runner exercises yt-dlp metadata and gallery album fallback',async()=>{
  const calls=[];let closed=0;
  const engine=createMediaEngine({status:async()=>({ytDlp:true,galleryDl:true,ffmpeg:true}),proxyFactory:async()=>({url:'http://127.0.0.1:1',close(){closed++;}}),runner:async(file,args)=>{calls.push({file,args});if(args.includes('-j'))return JSON.stringify([[3,'https://example.com/photo.jpg',{extension:'jpg',description:'Fotoğraf'}]]);throw new Error('No video');}});
  const media=await engine.inspect('https://www.instagram.com/p/abc/','instagram');assert.equal(media.items[0].type,'image');assert.equal(media.items[0].formats[0].ext,'jpg');assert.equal(closed,1);
  assert.ok(calls[0].args.includes('--ignore-config'));
  assert.ok(calls[1].args.includes('--config-ignore'));assert.ok(calls[1].args.includes('--http-timeout'));assert.ok(!calls[1].args.includes('--timeout'));
});
test('mock runner exercises real conversion argument contract',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'akis-convert-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const calls=[];
  const engine=createMediaEngine({proxyFactory:async()=>({url:'http://127.0.0.1:1',close(){}}),runner:async(file,args)=>{calls.push(args);if(args.includes('-f'))await writeFile(path.join(dir,'source.mkv'),'source');else await writeFile(args.at(-1),'converted');return '';}});
  const file=await engine.download(record().items[0],{format:'mp3',height:null,fps:null,bitrate:320},dir,new AbortController().signal,()=>{});
  assert.match(file,/akis\.mp3$/);assert.ok(calls[1].includes('libmp3lame'));assert.ok(calls[1].includes('320k'));assert.ok(calls[1].includes('file,pipe'));assert.ok(!calls[1].includes('-r'));assert.ok(!calls[1].includes('-s'));
});
test('worker pool limits concurrent downloads to two and drains queue',async t=>{
  let running=0,peak=0;const releases=[];let notifyTwo,notifyThree;const two=new Promise(r=>notifyTwo=r),three=new Promise(r=>notifyThree=r);let started=0;
  const {base,post}=await fixture(t,{download:async(_item,_request,dir)=>{running++;peak=Math.max(peak,running);await new Promise(resolve=>{releases.push(resolve);started++;if(started===2)notifyTwo();if(started===3)notifyThree();});running--;const file=path.join(dir,'result.mp4');await writeFile(file,'video');return file;}});
  const media=await(await post('/api/inspect',{url,platform:'youtube'})).json();
  const ids=[];
  for(const format of ['mp4','webm','original'])ids.push((await(await post('/api/download',{mediaId:media.id,itemId:media.items[0].id,format,bitrate:128})).json()).id);
  await two;
  assert.equal(releases.length,2);assert.equal(peak,2);
  assert.equal((await(await fetch(base+'/api/jobs/'+ids[2])).json()).status,'queued');
  releases.shift()();await three;
  for(const release of releases.splice(0))release();
  await Promise.all(ids.map(id=>complete(base,id)));assert.equal(peak,2);
});
test('process runner bounds time, output and cancellation',async()=>{
  await assert.rejects(run(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:30}),/zaman/);
  await assert.rejects(run(process.execPath,['-e','process.stdout.write("x".repeat(10000))'],{maxOutput:100}),/Output limit/);
  const controller=new AbortController();controller.abort();await assert.rejects(run(process.execPath,['-e',''],{signal:controller.signal}),/Cancelled/);
});
