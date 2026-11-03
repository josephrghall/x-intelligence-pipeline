import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TwitterApi } from 'twitter-api-v2';

const root='/opt/x-intelligence', mode=process.argv[2]||'status';
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
fs.mkdirSync(root+'/data',{recursive:true,mode:0o700});
const db=new DatabaseSync(root+'/data/'+(mode==='demo'?'demo.sqlite':'posts.sqlite'));
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, text TEXT NOT NULL, author TEXT, created TEXT, captured TEXT, source TEXT, category TEXT, score INTEGER); CREATE TABLE IF NOT EXISTS repos (post_id TEXT,url TEXT,description TEXT,license TEXT,stars INTEGER,archived INTEGER, PRIMARY KEY(post_id,url)); CREATE TABLE IF NOT EXISTS cursors (name TEXT PRIMARY KEY,last_id TEXT); CREATE TABLE IF NOT EXISTS reads (month TEXT,name TEXT,n INTEGER,time TEXT);");
const month=()=>new Date().toISOString().slice(0,7);
const used=()=>db.prepare('SELECT coalesce(sum(n),0) AS n FROM reads WHERE month=?').get(month()).n;
const count=()=>db.prepare('SELECT count(*) AS n FROM posts').get().n;
function repoUrl(str) {
 try {
  const u=new URL(str);
  if(!['github.com','www.github.com'].includes(u.hostname.toLowerCase())) return null;
  const p=u.pathname.split('/').filter(Boolean);
  if(p.length<2 || ['topics','features','explore','search','settings','orgs','login','sponsors'].includes(p[0].toLowerCase()))return null;
  const a=p[0],b=p[1].replace(/\.git$/i,'');
  return /^[\w.-]+$/.test(a)&&/^[\w.-]+$/.test(b)?'https://github.com/'+a+'/'+b:null;
 }catch{return null;}
}
function repos(post){
 const urls=[...(post.entities?.urls||[]).map(x=>x.expanded_url||x.url),...((post.text||'').match(/https?:\/\/[^\s<>"']+/g)||[])];
 return [...new Set(urls.map(repoUrl).filter(Boolean))];
}
function relevance(post,repository){
 const s=(post.text+' '+(repository?.description||'')).toLowerCase();
 const scores=Object.entries(cfg.topics).map(([k,v])=>[k,v.filter(x=>s.includes(x)).length]).sort((a,b)=>b[1]-a[1]);
 const [category,hits]=scores[0]||['other',0];
 return {category:hits?category:'other',score:Math.max(0,Math.min(100,12*hits+25*Boolean(repository)+10*Number(s.includes('open source'))+5*Number(!!repository?.license?.spdx_id)-25*Number(!!repository?.archived)))};
}
async function lookup(url){
 const [owner,name]=new URL(url).pathname.split('/').filter(Boolean);
 const headers={'Accept':'application/vnd.github+json','User-Agent':'x-intelligence/0.1'};
 if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
 const r=await fetch('https://api.github.com/repos/'+owner+'/'+name,{headers,signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error('GitHub HTTP '+r.status);
 return await r.json();
}
async function save(post,source,budget,demo=false){
 const links=repos(post);
 let git=null;
 if(links.length&&budget.left>0){
  budget.left--;
  if(demo)git={description:'Demo project',stargazers_count:12,archived:false,license:{spdx_id:'MIT'}};
  else try {git=await lookup(links[0]);}catch(e){console.error('Repo metadata: '+e.message);}
 }
 const rank=relevance(post,git);
 db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET score=excluded.score,category=excluded.category').run(String(post.id),post.text,String(post.author_id||''),post.created_at||'',new Date().toISOString(),source,rank.category,rank.score);
 for(const url of links) {
  const r=links[0]===url?git:null;
  db.prepare('INSERT INTO repos VALUES(?,?,?,?,?,?) ON CONFLICT(post_id,url) DO UPDATE SET description=excluded.description,license=excluded.license,stars=excluded.stars,archived=excluded.archived').run(String(post.id),url,r?.description||'',r?.license?.spdx_id||'unknown',r?.stargazers_count??null,r?.archived?1:0);
 }
}
function digest(){
 const rows=db.prepare('SELECT * FROM posts ORDER BY score DESC,captured DESC LIMIT 25').all();
 const lines=['# X intelligence shortlist','','Generated: '+new Date().toISOString(),'','Posts stored: '+count()+'; estimated public reads this UTC month: '+used()+'/'+cfg.monthlyLimit,'','> Preliminary relevance, not independent verification of claims.',''];
 for(const [i,p] of rows.entries()){
  lines.push('## '+(i+1)+'. '+p.category+' — '+p.score+'/100','Source: https://x.com/i/status/'+p.id,'Search: '+p.source,'Post claim (unverified): '+p.text.replace(/\s+/g,' ').slice(0,350));
  for(const r of db.prepare('SELECT * FROM repos WHERE post_id=?').all(p.id))lines.push('Repository: '+r.url+' | License: '+r.license+' | Stars: '+(r.stars??'unknown')+' | Archived: '+!!r.archived);
  lines.push('');
 }
 fs.mkdirSync(root+'/output',{recursive:true,mode:0o700});
 fs.writeFileSync(root+'/output/latest.md',lines.join('\n'),{mode:0o600});
 console.log('Digest: '+root+'/output/latest.md');
}
function status(){console.log(JSON.stringify({savedPosts:count(),utcMonth:month(),localReads:used(),localMonthlyCap:cfg.monthlyLimit,estimatedCostUSD:Number((used()*0.005).toFixed(3)),bearerConfigured:!!process.env.X_BEARER_TOKEN,note:'X Console spending limit is authoritative; this is a secondary safeguard.'},null,2));}
async function collect(){
 if(!process.env.X_BEARER_TOKEN)throw new Error('Missing X_BEARER_TOKEN. First configure billing cap in the X Developer Console.');
 const client=new TwitterApi(process.env.X_BEARER_TOKEN),budget={left:cfg.githubChecks};
 for(const q of cfg.queries){
  const left=cfg.monthlyLimit-used();
  if(left<10){console.log('Local monthly read cap reached.');break;}
  const args={query:q.query,max_results:Math.min(cfg.pageSize,left,100),'tweet.fields':'created_at,author_id,entities,public_metrics'};
  const cursor=db.prepare('SELECT last_id FROM cursors WHERE name=?').get(q.name)?.last_id;
  if(cursor)args.since_id=cursor;
  const result=await client.v2.get('tweets/search/recent',args),data=result.data||[];
  db.prepare('INSERT INTO reads VALUES(?,?,?,?)').run(month(),q.name,data.length,new Date().toISOString());
  for(const post of data)await save(post,q.name,budget);
  if(result.meta?.newest_id)db.prepare('INSERT INTO cursors VALUES(?,?) ON CONFLICT(name) DO UPDATE SET last_id=excluded.last_id').run(q.name,result.meta.newest_id);
  console.log(q.name+': '+data.length+' public posts; month '+used()+'/'+cfg.monthlyLimit);
 }
 digest();
}
async function demo(){
 const posts=[
  {id:'1000000000000000001',text:'Open source AI agent MCP orchestration',entities:{urls:[{expanded_url:'https://github.com/example/agent-tools'}]}},
  {id:'1000000000000000002',text:'Local-first SQLite markdown second brain https://github.com/example/notes'},
  {id:'1000000000000000003',text:'Celebrity concert photo'}];
 const budget={left:3};
 for(const p of posts)await save(p,'demo',budget,true);
 digest();status();
}
try {if(mode==='status')status();else if(mode==='digest')digest();else if(mode==='collect')await collect();else if(mode==='demo')await demo();else throw new Error('Unknown mode: '+mode);}
catch(e){console.error(e.message);process.exitCode=1;} finally {db.close();}
