#!/usr/bin/env node
/**
 * probe-limits.js  —  Baton skill helper
 * No hardcoded providers, limit values, model names, or API endpoints.
 * Provider probe configs live in provider-probes.json.
 * All limit values come from user input or live API queries.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const HOME         = process.env.HOME || process.env.USERPROFILE;
const OPENCLAW_DIR = path.join(HOME, '.openclaw');
const BATON_DIR    = path.join(OPENCLAW_DIR, 'baton');
const REGISTRY     = path.join(BATON_DIR, 'model-registry-cache.json');
const LIMITS       = path.join(BATON_DIR, 'limit-config.json');
const STATE        = path.join(BATON_DIR, 'instance-state.json');
const HASH_FILE    = path.join(BATON_DIR, 'config-hash.txt');
const CONFIG_FILE  = path.join(OPENCLAW_DIR, 'openclaw.json');
const PROBES_FILE  = path.join(__dirname, 'provider-probes.json');
function ensureDir() {
  [BATON_DIR,path.join(BATON_DIR,'tasks'),path.join(BATON_DIR,'archive'),
   path.join(BATON_DIR,'templates'),path.join(BATON_DIR,'checkpoints'),
   path.join(HOME,'.openclaw','workspace','baton-outputs')]
    .forEach(d=>{if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});});
}
function readJson(f,fb={}){try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return fb;}}
function writeJson(f,d){const tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify(d,null,2));fs.renameSync(tmp,f);}
function hashFile(f){try{return crypto.createHash('sha256').update(fs.readFileSync(f,'utf8')).digest('hex');}catch{return null;}}
function now(){return new Date().toISOString();}
function log(m){process.stderr.write('[probe-limits] '+m+'\n');}
function windowToSeconds(w){
  if(!w)return 86400;
  const{kind,value=1,hours}=w;
  switch(kind){case'rps':return value;case'rpm':return value*60;case'rph':return value*3600;
    case'rpd':return value*86400;case'rpw':return value*604800;case'rp_window':return(hours??value)*3600;default:return value*60;}
}
function loadProbes(){return readJson(PROBES_FILE,{providers:{},localUrlPatterns:[]});}
function isLocalProvider(c){const url=(c?.baseUrl??'').toLowerCase();return loadProbes().localUrlPatterns.some(p=>url.includes(p));}
function isExternalSelfHosted(c){
  const url=(c?.baseUrl??'').toLowerCase();if(!url||isLocalProvider(c))return false;
  const cloud=['openai.com','anthropic.com','googleapis.com','azure.com','groq.com','mistral.ai','cohere.com','together.ai','fireworks.ai','openrouter.ai','perplexity.ai','deepseek.com'];
  return!cloud.some(cc=>url.includes(cc));
}
function resolveApiKey(cfg,pid,hints=[]){
  for(const k of hints)if(process.env[k])return process.env[k];
  const env=cfg?.env??{};for(const k of hints)if(env[k])return env[k];
  const pc=cfg?.models?.providers?.[pid];if(pc?.apiKey&&!String(pc.apiKey).startsWith('secretref-'))return pc.apiKey;
  return null;
}
function getNestedPath(obj,dot){return dot.split('.').reduce((c,k)=>c?.[k],obj);}
async function probeProvider(pid,live=false){
  const probes=loadProbes();const cfg=readJson(CONFIG_FILE);const pc=cfg?.models?.providers?.[pid]??{};
  if(isLocalProvider(pc))return{autoDetected:true,providerId:pid,topology:'unlimited',bucket:{unlimited:true},reason:'local_host'};
  if(isExternalSelfHosted(pc))return{autoDetected:true,providerId:pid,topology:'unlimited',bucket:{unlimited:true},reason:'external_self_hosted'};
  const probe=probes.providers?.[pid];
  if(!probe)return{autoDetected:false,providerId:pid,reason:'no_probe_config',note:`Provider "${pid}" has no auto-detection config. Add to provider-probes.json or collect limits from user.`};
  const method=probe.limitQueryMethod;
  if(method==='local_unlimited')return{autoDetected:true,providerId:pid,topology:'unlimited',bucket:{unlimited:true}};
  if(method==='none')return{autoDetected:false,providerId:pid,reason:'no_query_method',knownTopology:probe.knownTopology,note:probe.notes};
  if(method==='openclaw_status'){
    try{
      const raw=execSync(`${probe.openclaw_status_cmd??'openclaw models status --json'} 2>/dev/null`,{encoding:'utf8',timeout:10000});
      const p=JSON.parse(raw);const lu=p.usage??p.limits??null;
      if(live&&lu)updateLimitsCache(pid,lu);
      return{autoDetected:true,providerId:pid,topology:probe.knownTopology??'providerBucket',bucket:{dynamicQuery:true},liveUsage:lu};
    }catch(e){return{autoDetected:false,providerId:pid,reason:`openclaw_status_failed: ${e.message}`};}
  }
  if(method==='http_get'){
    const{url,authHeader,apiKeyEnvHints=[],responsePaths={}}=probe;
    if(!url)return{autoDetected:false,providerId:pid,reason:'missing_url'};
    const apiKey=resolveApiKey(cfg,pid,apiKeyEnvHints);
    if(!apiKey)return{autoDetected:false,providerId:pid,reason:'no_api_key'};
    try{
      const headers={'Content-Type':'application/json'};
      if(authHeader==='Bearer')headers['Authorization']=`Bearer ${apiKey}`;
      else if(authHeader==='x-api-key')headers['x-api-key']=apiKey;
      else if(authHeader)headers[authHeader]=apiKey;
      const res=await fetch(url,{headers});if(!res.ok)return{autoDetected:false,providerId:pid,reason:`http_${res.status}`};
      const body=await res.json();const ext={};
      for(const[f,dp]of Object.entries(responsePaths)){const v=getNestedPath(body,dp);if(v!==undefined)ext[f]=v;}
      const lu={used:ext.used??null,limit:ext.limit??null,resetAt:ext.resetAt??null,unlimited:ext.unlimited??(ext.limit===null&&ext.used!==undefined)};
      if(live)updateLimitsCache(pid,lu);
      return{autoDetected:true,providerId:pid,topology:probe.knownTopology??'providerBucket',bucket:{limit:lu.limit,unlimited:lu.unlimited,dynamicQuery:true},liveUsage:lu};
    }catch(e){return{autoDetected:false,providerId:pid,reason:e.message};}
  }
  return{autoDetected:false,providerId:pid,reason:`unknown_method: ${method}`};
}
function updateLimitsCache(pid,lu){
  if(!lu)return;const s=readJson(STATE);s.limitsCache=s.limitsCache??{};
  s.limitsCache[pid]={fetchedAt:now(),used:lu.used??0,remaining:lu.limit!=null?lu.limit-(lu.used??0):null,limit:lu.limit??null,resetAt:lu.resetAt??null,unlimited:lu.unlimited??false};
  writeJson(STATE,s);
}

/**
 * Build model registry.
 * Sources models from both instance openclaw.json AND agent-specific models.json.
 * Per-agent models are tagged with agentId so selection can enforce agent scope.
 */
async function buildRegistry(){
  ensureDir();log('Building model registry...');
  let raw;try{raw=execSync('openclaw models list --json 2>/dev/null',{encoding:'utf8',timeout:30000});}
  catch(e){log(`ERROR: openclaw models list failed — ${e.message}`);process.exit(1);}
  let entries;try{const p=JSON.parse(raw);entries=Array.isArray(p)?p:(p.models??Object.values(p));}
  catch{log('ERROR: parse failed');process.exit(1);}
  const existing=readJson(REGISTRY,{models:{}});
  const models={};
  // Instance-wide models from openclaw models list (sourced from openclaw.json + any agent models.json that openclaw exposes)
  for(const m of entries){
    const id=m.id??[m.provider,m.model].filter(Boolean).join('/');if(!id)continue;
    const prev=existing.models?.[id]??{};
    const keepCap=prev.capableSource==='user'||prev.capableSource==='web';
    const keepSpd=prev.speedSource==='user'||prev.speedSource==='measured';
    models[id]={
      alias:m.alias??m.name??id.split('/').pop(),
      contextWindow:m.contextWindow??m.context_window??prev.contextWindow??null,
      capable:keepCap?prev.capable:null,capableSource:keepCap?prev.capableSource:null,capableNotes:prev.capableNotes??null,
      speed:keepSpd?prev.speed:null,speedSource:keepSpd?prev.speedSource:null,
      costPerMTokenInput:m.cost?.input??prev.costPerMTokenInput??null,
      costPerMTokenOutput:m.cost?.output??prev.costPerMTokenOutput??null,
      knownUnlimited:prev.knownUnlimited??false,
      authOk:!String(m.auth??'').toLowerCase().includes('unknown'),
      policy:prev.policy??null,
      agentScope:m.agentId??null   // non-null = only available to this specific agent
    };
  }
  // Also scan agent-specific models.json files for any models not surfaced by openclaw models list
  try{
    const agentsDir=path.join(HOME,'.openclaw','agents');
    if(fs.existsSync(agentsDir)){
      for(const agentId of fs.readdirSync(agentsDir)){
        const agentModelsPath=path.join(agentsDir,agentId,'agent','models.json');
        if(!fs.existsSync(agentModelsPath))continue;
        const agentModels=readJson(agentModelsPath,{});
        const providers=agentModels.providers??{};
        for(const[providerId,pc]of Object.entries(providers)){
          for(const m of(pc.models??[])){
            const id=`${providerId}/${m.id}`;
            if(models[id])continue; // already in instance-wide registry
            const prev=existing.models?.[id]??{};
            const keepCap=prev.capableSource==='user'||prev.capableSource==='web';
            const keepSpd=prev.speedSource==='user'||prev.speedSource==='measured';
            models[id]={
              alias:m.name??m.id,contextWindow:m.contextWindow??prev.contextWindow??null,
              capable:keepCap?prev.capable:null,capableSource:keepCap?prev.capableSource:null,capableNotes:prev.capableNotes??null,
              speed:keepSpd?prev.speed:null,speedSource:keepSpd?prev.speedSource:null,
              costPerMTokenInput:m.cost?.input??prev.costPerMTokenInput??null,
              costPerMTokenOutput:m.cost?.output??prev.costPerMTokenOutput??null,
              knownUnlimited:prev.knownUnlimited??false,authOk:true,policy:prev.policy??null,
              agentScope:agentId  // exclusively this agent's model
            };
          }
        }
      }
    }
  }catch(e){log(`WARNING: could not scan agent models.json files: ${e.message}`);}
  writeJson(REGISTRY,{builtAt:now(),configHash:hashFile(CONFIG_FILE),models});
  log(`Registry: ${Object.keys(models).length} models (${Object.values(models).filter(m=>m.agentScope).length} agent-scoped)`);
  console.log(JSON.stringify({ok:true,modelCount:Object.keys(models).length,models:Object.keys(models)}));
}

async function checkConfigHash(){
  ensureDir();const cur=hashFile(CONFIG_FILE);
  const saved=fs.existsSync(HASH_FILE)?fs.readFileSync(HASH_FILE,'utf8').trim():null;
  if(!saved){if(cur)fs.writeFileSync(HASH_FILE,cur);console.log(JSON.stringify({changed:true,reason:'first_run',hash:cur}));return;}
  if(cur!==saved)console.log(JSON.stringify({changed:true,hash:cur,previousHash:saved}));
  else console.log(JSON.stringify({changed:false,hash:cur}));
}

async function diffConfig(){
  const cfg=readJson(CONFIG_FILE);const limits=readJson(LIMITS);const registry=readJson(REGISTRY,{models:{}});const probes=loadProbes();
  const custom=Object.keys(cfg?.models?.providers??{});const builtIn=Object.keys(probes.providers??{});
  const all=[...new Set([...custom,...builtIn])];const known=Object.keys(limits?.providers??{});
  const newProviders=all.filter(p=>!known.includes(p));const removedProviders=known.filter(p=>!all.includes(p));
  const newModels={};const needsCaps=[];
  for(const[mid,m]of Object.entries(registry.models??{})){
    if(!m.capable||!m.speed)needsCaps.push(mid);
    const si=mid.indexOf('/');if(si===-1)continue;
    const pid=mid.slice(0,si),mk=mid.slice(si+1);const pl=limits?.providers?.[pid];
    if(pl?.topology==='perModel'&&!pl.models?.[mk]){(newModels[pid]??=[]).push(mk);}
  }
  console.log(JSON.stringify({newProviders,removedProviders,newModels,modelsNeedingCapabilities:needsCaps}));
}

function computeHeadroom(modelId){
  const limits=readJson(LIMITS);const state=readJson(STATE);
  const si=modelId.indexOf('/');if(si===-1){console.log(JSON.stringify({error:'need provider/model format'}));return;}
  const pid=modelId.slice(0,si),mk=modelId.slice(si+1);const pc=limits?.providers?.[pid];
  if(!pc){console.log(JSON.stringify({headroom:Infinity,unlimited:true,reason:'no_limit_config'}));return;}
  const mc=pc.models?.[mk]??{};
  if(mc.override==='unlimited'){console.log(JSON.stringify({headroom:Infinity,unlimited:true,reason:'model_unlimited'}));return;}
  let bucket=null,bk=null;
  if(mc.override==='own'&&mc.bucket){bucket=mc.bucket;bk=`${pid}:${mk}`;}
  else if(pc.topology==='unlimited'||pc.bucket?.unlimited){console.log(JSON.stringify({headroom:Infinity,unlimited:true,reason:'provider_unlimited'}));return;}
  else if(pc.bucket){bucket=pc.bucket;bk=pid;}
  if(!bucket||!bk){console.log(JSON.stringify({headroom:Infinity,unlimited:true,reason:'no_bucket'}));return;}
  if(bucket.dynamicQuery){
    const c=state.limitsCache?.[pid];const age=c?Date.now()-new Date(c.fetchedAt).getTime():Infinity;
    if(c&&age<60000){console.log(JSON.stringify({headroom:c.remaining!==null?c.remaining:Infinity,used:c.used,limit:c.limit,fromCache:true,cacheAgeMs:age}));return;}
    console.log(JSON.stringify({headroom:null,needsRefresh:true,providerId:pid,cacheAgeMs:age}));return;
  }
  const ws=windowToSeconds(bucket.window),cutMs=Date.now()-ws*1000;
  const reqs=state.windowCounters?.[bk]?.requests??[];
  const used=reqs.filter(ts=>new Date(ts).getTime()>cutMs).length;
  const h=bucket.limit-used,ratio=bucket.limit>0?Math.round(h/bucket.limit*100)/100:1;
  console.log(JSON.stringify({headroom:h,used,limit:bucket.limit,ratio,windowSecs:ws,bucketKey:bk}));
}

function updateState(patchJson){
  ensureDir();let patch;try{patch=JSON.parse(patchJson);}catch{log('ERROR: invalid JSON patch');process.exit(1);}
  const s=readJson(STATE,{lastUpdated:now(),activeSessions:{},windowCounters:{},modelLatency:{},recentFailures:{},limitsCache:{}});
  if(patch.addSession)s.activeSessions[patch.addSession.sessionId]={...patch.addSession.data,recordedAt:now()};
  if(patch.removeSession)delete s.activeSessions[patch.removeSession];
  if(patch.recordRequest){
    const{bucketKey,windowSecs}=patch.recordRequest;
    const counter=(s.windowCounters[bucketKey]??={requests:[]});
    const cutoff=new Date(Date.now()-windowSecs*1000).toISOString();
    counter.requests=counter.requests.filter(ts=>ts>cutoff);counter.requests.push(now());
  }
  if(patch.recordLatency){
    const{model,elapsedMs}=patch.recordLatency;const e=s.modelLatency[model]??{p50Ms:elapsedMs,p95Ms:elapsedMs,samples:0};
    const n=e.samples+1;e.p50Ms=Math.round((e.p50Ms*e.samples+elapsedMs)/n);
    e.p95Ms=Math.round(Math.max(e.p95Ms*0.95,elapsedMs));e.samples=n;e.updatedAt=now();s.modelLatency[model]=e;
  }
  if(patch.recordFailure){const{model,reason}=patch.recordFailure;const e=s.recentFailures[model]??{count:0};e.count+=1;e.lastAt=now();e.reason=reason;s.recentFailures[model]=e;}
  if(patch.clearFailures)delete s.recentFailures[patch.clearFailures];
  if(patch.pruneStale){const ns=now();for(const[sid,ss]of Object.entries(s.activeSessions))if(ss.timeoutAt&&ss.timeoutAt<ns)delete s.activeSessions[sid];}
  s.lastUpdated=now();writeJson(STATE,s);console.log(JSON.stringify({ok:true}));
}

function pruneWindows(){
  const s=readJson(STATE);const l=readJson(LIMITS);
  if(!s.windowCounters){console.log(JSON.stringify({ok:true,pruned:0}));return;}
  let pruned=0;
  for(const[bk,c]of Object.entries(s.windowCounters)){
    const ci=bk.indexOf(':');const pid=ci!==-1?bk.slice(0,ci):bk;const mk=ci!==-1?bk.slice(ci+1):null;
    const pc=l?.providers?.[pid];let ws=86400;
    if(pc){const b=mk?(pc.models?.[mk]?.bucket??pc.bucket):pc.bucket;if(b?.window)ws=windowToSeconds(b.window);}
    const cutoff=new Date(Date.now()-ws*1000).toISOString();
    const before=c.requests.length;c.requests=c.requests.filter(ts=>ts>cutoff);pruned+=before-c.requests.length;
  }
  writeJson(STATE,s);console.log(JSON.stringify({ok:true,pruned}));
}

function modelInfo(modelId){
  const name=modelId.split('/').pop(),provider=modelId.split('/')[0];
  console.log(JSON.stringify({
    modelId,searchQuery:`"${name}" AI model capabilities use cases 2025`,
    alternateQuery:`${provider} ${name} benchmark speed context window review`,
    extractFields:['Best use cases','Poor use cases','Speed/throughput','Context window','Reasoning model?','Multimodal support?','Tool use support?'],
    fallback:'ask_user'
  }));
}

async function probeAllProviders(){
  ensureDir();const cfg=readJson(CONFIG_FILE);const probes=loadProbes();
  const all=[...new Set([...Object.keys(cfg?.models?.providers??{}),...Object.keys(probes.providers??{})])];
  const results={};
  for(const pid of all){try{results[pid]=await probeProvider(pid,false);}catch(e){results[pid]={autoDetected:false,providerId:pid,reason:e.message};}}
  console.log(JSON.stringify(results));
}

const args=process.argv.slice(2);const cmd=args[0];
(async()=>{
  try{
    switch(cmd){
      case'--build-registry':await buildRegistry();break;
      case'--check-config-hash':await checkConfigHash();break;
      case'--diff-config':await diffConfig();break;
      case'--probe-all-providers':await probeAllProviders();break;
      case'--probe-provider':{if(!args[1]){log('need provider id');process.exit(1);}console.log(JSON.stringify(await probeProvider(args[1],args.includes('--live'))));break;}
      case'--compute-headroom':{if(!args[1]){log('need provider/model-id');process.exit(1);}computeHeadroom(args[1]);break;}
      case'--update-state':{if(!args[1]){log('need JSON patch');process.exit(1);}updateState(args[1]);break;}
      case'--prune-windows':pruneWindows();break;
      case'--model-info':{if(!args[1]){log('need model id');process.exit(1);}modelInfo(args[1]);break;}
      default:log(`Unknown: ${cmd??'(none)'}`);process.exit(1);
    }
  }catch(e){log(`FATAL: ${e.message}\n${e.stack}`);process.exit(1);}
})();
