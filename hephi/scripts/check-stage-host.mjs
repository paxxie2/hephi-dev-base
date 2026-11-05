// Opt-in host API fixture integration; never counts as real Issue/Worker E2E.
import { mkdtemp, cp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
const exec=promisify(execFile)
if (!process.argv[2]) throw new Error('Usage: node scripts/check-stage-host.mjs /path/to/rc.5/node_modules (fixture integration, not E2E)')
const root=await mkdtemp(join(tmpdir(),'hephi-native-stage-'))
await cp(fileURLToPath(new URL('../lib', import.meta.url)),join(root,'lib'),{recursive:true})
await symlink(resolve(process.argv[2]),join(root,'node_modules'))
await writeFile(join(root,'package.json'),'{"type":"module"}')
const script=`
import assert from 'node:assert/strict';
import { Context, Inject } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { createScope } from '@deepseek-ai/dsh-scope';
import * as hephi from './lib/index.mjs';
const { mountWorkerGate, prepareActivation } = hephi;
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const repo=new URL('./repo',import.meta.url).pathname;mkdirSync(repo);
const git=(...a)=>execFileSync('git',a,{cwd:repo,encoding:'utf8'}).trim();
git('init');git('config','user.name','Native test');git('config','user.email','test@example.invalid');writeFileSync(repo+'/a','base');git('add','.');git('commit','-m','base');
const state=new URL('./state',import.meta.url).pathname;
await prepareActivation({HEPHI_VERIFICATION_CHECKS:JSON.stringify({version:1,checks:[{id:'build',kind:'build',purpose:'host fixture',command:'true',args:[]}]}),HEPHI_ENABLED:'1',HEPHI_EXECUTION_MODE:'staged',HEPHI_STATE_DIR:state,HEPHI_BASE_COMMIT:git('rev-parse','HEAD'),HEPHI_ALLOWED_PATHS:'**',HEPHI_TEST_COMMAND:'true',HEPHI_REVERSE_TEST_COMMAND:'true',DSH_SUPERAGENT_TICKET:'native-test',DSH_SUPERAGENT_DIR:repo,DSH_SUPERAGENT_GITHUB_REPOSITORY:'fixture/local',DSH_SUPERAGENT_GITHUB_NUMBER:'1'});
const ctx=new Context();await ctx.plugin(SystemPrompt,{}).await();await ctx.plugin(ToolRuntime,{}).await();
// This fixture supplies identity/jobs only; all tool dispatch, guards and result events use real rc.5 services.
ctx.provide('jobs',{list:()=>[]});
ctx.provide('sessionQuery',{readSession:async id=>({session:{id},inheritedEventCount:0,events:[]})});
ctx.provide('subagents',{listChildren:async()=>[]});
// Cover the actual bundle entry as well as the scoped adapter below.
assert.deepEqual(Object.keys(Inject.resolve(hephi.inject)).sort(),['agents','systemPrompt','tools'].sort());
assert.equal(ctx.get('jobs')!==undefined,true,'staged fixture requires the optional jobs service');
let entryReads=0;
ctx.provide('agents',{list:()=>{entryReads++;return []},get:()=>undefined});
const entry=ctx.plugin(hephi,{stateDir:state});await entry.await();
assert(entryReads>0,'plugin apply must actually run, not remain pending');
await entry.dispose();
let done=false;
await ctx.inject(['tools','systemPrompt','jobs','sessionQuery'],async (ctx)=>{
const agent={id:'worker-native-test',session:{header:{id:'worker-native-test',agentPreset:'dsh-superagent-worker',cwd:repo}}};
const scope=createScope(ctx,agent);agent.ctx=scope.ctx;
const output={schema:{type:'json'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]};
ctx.tools.register(defineTool({name:'write',description:'Fixture mutation',parameters:{},output,execute:async()=>({written:true})}));
ctx.tools.register(defineTool({name:'orchestrator_report',description:'Fixture report acknowledgement',parameters:{state:{type:'string',required:true},summary:{type:'string'}},output,execute:async()=>({reported:true})}));
const delegation={description:'Fixture delegation',parameters:{},output,execute:async()=>({started:true})};
ctx.tools.register(defineTool({name:'subagent',...delegation}));
ctx.tools.register(defineTool({name:'spawn_teammate',...delegation}));
agent.ctx.tools.restrict({allow:['write','orchestrator_report','subagent','spawn_teammate']});
let hold=false,verificationStarted,releaseVerification;
const verify=async()=>{if(hold){verificationStarted();await new Promise(r=>releaseVerification=r)}return {ok:true}};
let mounted=mountWorkerGate(ctx,agent,{stateDir:state,verify});
assert(agent.ctx.tools.get('hephi_stage',agent),'scoped stage tool must survive inherited allow mask');
let n=0;const call=(name,args)=>ctx.tools.execute({name,arguments:args,agent,callId:'test-'+(++n),signal:new AbortController().signal});
let r=await call('write',{});assert.equal(r.isError,true,'staged must reject mutation before plan');
r=await call('subagent',{});assert.equal(r.isError,true,'staged must reject delegated implementation before plan');
r=await call('spawn_teammate',{});assert.equal(r.isError,true,'staged must reject an Agent Team before plan');
const plan=['A','B'].map(id=>({id,objective:id,scope:['**'],checks:[{id:'node',command:process.execPath,args:['-e','console.log("real process")']}]}));
r=await call('hephi_stage',{action:'plan',reason:'host integration fixture',planJson:JSON.stringify(plan)});assert.equal(r.isError,false,JSON.stringify(r));
r=await call('write',{});assert.equal(r.isError,true);
r=await call('subagent',{});assert.equal(r.isError,true,'staged must keep delegation closed between plan and start');
for(const id of ['A','B']){
 r=await call('hephi_stage',{action:'start',stageId:id});assert.equal(r.isError,false,JSON.stringify(r));
 // A later guard denial/cancellation must release its admission, not strand finish.
 const removeGuard=agent.ctx.tools.guard(e=>e.name==='write'?'fixture later denial':undefined);
 r=await call('write',{});assert.equal(r.isError,true);removeGuard();
 const abort=new AbortController();
 const cancelled=await ctx.tools.prepareScheduledExecution({name:'write',arguments:{},agent,callId:'test-'+(++n),signal:abort.signal});
 assert.equal(cancelled.kind,'dispatch');abort.abort();
 r=await ctx.tools.completeScheduledExecution(cancelled);assert.equal(r.isError,true);
 // Exercise rc.5's scheduler seam: admitted mutation has not yet dispatched.
 const admitted=await ctx.tools.prepareScheduledExecution({name:'write',arguments:{},agent,callId:'test-'+(++n),signal:new AbortController().signal});
 assert.equal(admitted.kind,'dispatch');
 let finishSettled=false;
 const finishing=call('hephi_stage',{action:'finish',stageId:id}).then(r=>{finishSettled=true;return r});
 await new Promise(r=>setTimeout(r,250));
 const waited=!finishSettled;
 const late=await ctx.tools.completeScheduledExecution(admitted);
 r=await finishing;
 assert(waited,'finish must wait for admitted-but-undispatched mutations');
 assert.equal(late.isError,true,'late dispatch must be refused while checking');
 assert.equal(r.isError,false,JSON.stringify(r));const marker=r.value.progressMarker;
 mounted.dispose();mounted=mountWorkerGate(ctx,agent,{stateDir:state,verify});
 r=await call('write',{});assert.equal(r.isError,true);
 r=await call('hephi_stage',{action:'finish',stageId:id});assert.equal(r.isError,false,'a denied write after remount must not poison recovery: '+JSON.stringify(r));
 r=await call('orchestrator_report',{state:'progress',summary:marker});assert.equal(r.isError,false,JSON.stringify(r));
}
const entered=new Promise(r=>verificationStarted=r);hold=true;
const ready=call('orchestrator_report',{state:'ready'});await entered;
r=await call('write',{});assert.equal(r.isError,true,'ready must hold mutation closed');
r=await call('subagent',{});assert.equal(r.isError,true,'ready must hold delegation closed');
r=await call('orchestrator_report',{state:'ready'});assert.equal(r.isError,true,'concurrent ready must be denied');
r=await call('write',{});assert.equal(r.isError,true,'denied concurrent ready must not release original lock');
releaseVerification();r=await ready;assert.equal(r.isError,false,JSON.stringify(r));
r=await call('write',{});assert.equal(r.isError,false,'settled original ready releases its own lock');
mounted.dispose();await scope.dispose();done=true;
}).await();assert(done,'native integration did not complete');await ctx.fiber.dispose();console.log('PASS: real installed DSH tool dispatch/scoped visibility/guard/progress events; fixture Agent/report/jobs, not Worker or Issue E2E');
`;
await writeFile(join(root,'check.mjs'),script)
try{const r=await exec(process.execPath,[join(root,'check.mjs')],{timeout:20000});console.log(root);console.log(r.stdout)}catch(e){console.log(root);console.log(e.stdout,e.stderr);process.exitCode=1}
