/** Actual standalone production image, synthetic upstream in the same container.
 * No real session, app .env, AWS credentials, database or public port is used. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { request } from 'node:http';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const image = process.argv[2];
if (!image || !/^[a-z0-9][a-z0-9._/:@-]*$/.test(image)) throw new Error('Provide a locally built frontend image');
const directory = await mkdtemp(join(tmpdir(),'orbit-bff-image-'));
const name = 'orbit-bff-image-'+randomUUID();
let started = false;
try {
  await chmod(directory,0o755);
  await writeFile(join(directory,'upstream.cjs'), `
const http=require('node:http'),{createHash}=require('node:crypto');
let held=0;
http.createServer(async(req,res)=>{
 if(req.method==='GET'){res.end(JSON.stringify({held}));return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const bytes=Buffer.concat(chunks);const reply=()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({received:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mime:req.headers['content-type']}));};
 if(req.url.includes('hold=1')){held++;setTimeout(()=>{held--;reply();},3000);}else reply();
}).listen(18001,'127.0.0.1');
`,{mode:0o644});
  await exec('docker',['run','--detach','--rm','--name',name,'--read-only','--tmpfs','/app/.next/cache:rw,size=32m,uid=1001,gid=1001','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','1g','--publish','127.0.0.1::3000','--mount',`type=bind,src=${directory},dst=/fixtures,readonly`,'--env','ORBIT_API_URL=http://127.0.0.1:18001/api/v1','--env','FRONTEND_ORIGIN=https://orbit.test','--env','AUTH_COOKIE_SECURE=true',image,'sh','-c','node /fixtures/upstream.cjs & exec node server.js']);
  started = true;
  const port=Number((await exec('docker',['port',name,'3000/tcp'])).stdout.trim().split(':').at(-1));
  const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:'fixture-upload',sid:'fixture-upload',type:'access',organizationId:null,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.synthetic-signature';
  const send=(body=Buffer.from('%PDF-fixture'),extra={},path='/api/orbit/storage/objects',method='PUT')=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method,headers:{origin:'https://orbit.test','sec-fetch-site':'same-origin','content-type':'application/pdf',cookie:'orbit_access='+token,...extra}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.setTimeout(10000,()=>req.destroy(new Error('Local BFF fixture timeout')));req.on('error',reject);if(method==='GET'||method==='HEAD')req.end();else req.end(body);
  });
  for(let n=0;;n++){try{if((await send(Buffer.alloc(0),{cookie:''},'/api/orbit/storage/objects','GET')).status===401)break;}catch{/* startup only */}if(n>=60)throw new Error('Standalone image did not start');await new Promise(r=>setTimeout(r,250));}
  assert.equal((await send(Buffer.from('x'),{cookie:''})).status,401);
  assert.equal((await send(Buffer.alloc(0),{'content-length':'20971521'})).status,413);
  assert.equal((await send(Buffer.alloc(1_048_577),{'content-type':'application/json','transfer-encoding':'chunked'})).status,413);
  const body=Buffer.alloc(20*1024*1024,65);body.write('%PDF-fixture');
  const raw=await send(body);assert.equal(raw.status,200);assert.equal(JSON.parse(raw.body).sha256,createHash('sha256').update(body).digest('hex'));
  const multipart=Buffer.concat([Buffer.from('--fixture\r\nContent-Disposition: form-data; name="file"; filename="private.pdf"\r\nContent-Type: application/pdf\r\n\r\n'),body,Buffer.from('\r\n--fixture--\r\n')]);
  const form=await send(multipart,{'content-type':'multipart/form-data; boundary=fixture'});assert.equal(form.status,200);assert.equal(JSON.parse(form.body).sha256,createHash('sha256').update(multipart).digest('hex'));assert.equal(JSON.parse(form.body).mime,'multipart/form-data; boundary=fixture');
  const held=Array.from({length:4},()=>send(Buffer.from('%PDF-fixture'),{},'/api/orbit/storage/objects?hold=1'));
  for(let n=0;;n++){const stats=JSON.parse((await send(undefined,{},'/api/orbit/storage/objects?stats=1','GET')).body);if(stats.held===4)break;if(n>=80)throw new Error('Concurrent requests did not reach the fixture');await new Promise(r=>setTimeout(r,20));}
  const saturated=await send(Buffer.from('%PDF-fixture'));assert.equal(saturated.status,429);assert.equal(saturated.headers['retry-after'],'5');
  for(const response of await Promise.all(held))assert.equal(response.status,200);
  assert.equal((await send(body)).status,200);
  console.log(JSON.stringify({stage:'upload-bff-production-image',checks:8,status:'PASS',authenticity:'Synthetic backend; no claim of real session authentication',nativeNode:(await exec('docker',['exec',name,'node','--version'])).stdout.trim()}));
} catch (error) {
  if (started) { const logs=await exec('docker',['logs','--tail','40',name]);console.error(logs.stdout+logs.stderr); }
  throw error;
} finally {
  if(started)await exec('docker',['stop','--timeout','5',name]);
  await rm(directory,{recursive:true,force:true});
}
