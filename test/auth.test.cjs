'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const authCode=fs.readFileSync(path.join(__dirname,'../dist/auth.js'),'utf8');

function fixture({configured=true,user=null,signupSession=true,legacy=null,accountData=null}={}){
  const elements=new Map();
  class FakeElement{
    constructor(tag='div'){
      this.tag=tag;this._id='';this.hidden=false;this.value='';this.textContent='';
      this.disabled=false;this.listeners={};this.children=[];this.style={};this.classSet=new Set();
      this.classList={add:n=>this.classSet.add(n),remove:n=>this.classSet.delete(n),toggle:(n,v)=>v?this.classSet.add(n):this.classSet.delete(n)};
    }
    set id(id){this._id=id;elements.set(id,this)}
    get id(){return this._id}
    set innerHTML(value){
      this._html=value;
      for(const m of value.matchAll(/id="([^"]+)"/g)){
        if(!elements.has(m[1])){const child=new FakeElement();child.id=m[1];const tag=value.slice(value.lastIndexOf('<',m.index),value.indexOf('>',m.index)+1);child.hidden=/\shidden(?:\s|>|=)/.test(tag)}
      }
    }
    get innerHTML(){return this._html||''}
    querySelector(selector){return elements.get(selector.slice(1))||null}
    addEventListener(event,handler){this.listeners[event]=handler}
    click(){return this.listeners.click?.({preventDefault(){}})}
    submit(){return this.listeners.submit?.({preventDefault(){}})}
    append(...children){this.children.push(...children)}
    remove(){this.wasRemoved=true}
  }
  const body=new FakeElement('body');body.classList.add('auth-locked');
  const header=new FakeElement('header');
  const document={body,createElement:t=>new FakeElement(t),querySelector:s=>s==='header'?header:null};
  const data=new Map();
  if(legacy!==null)data.set('one-step-v1',JSON.stringify({tasks:legacy,settings:{timer:true}}));
  if(accountData!==null)data.set('one-step-v1:test-user',JSON.stringify({tasks:accountData}));
  const storage={
    getItem(k){return data.has(k)?data.get(k):null},
    setItem(k,v){data.set(k,String(v))},
    removeItem(k){data.delete(k)}
  };
  const identity={id:'test-user',email:'user@example.com'};
  const calls={signIn:[],signUp:[],signOut:[],createClient:[],getUser:0,reloads:0};
  let observer=null;
  const client={auth:{
    onAuthStateChange(fn){observer=fn;return {data:{subscription:{unsubscribe(){}}}}},
    async getUser(){calls.getUser++;return {data:{user},error:user?null:{name:'AuthSessionMissingError'}}},
    async signInWithPassword(input){calls.signIn.push(input);return {data:{session:{user:identity}},error:null}},
    async signUp(input){calls.signUp.push(input);return {data:{session:signupSession?{user:identity}:null},error:null}},
    async signOut(input){calls.signOut.push(input);observer?.('SIGNED_OUT');return {error:null}},
  }};
  const context=vm.createContext({
    document,localStorage:storage,
    window:{
      ONE_STEP_SUPABASE:configured?{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}: {url:'',publishableKey:''},
      supabase:{createClient:(...args)=>{calls.createClient.push(args);return client}},
      location:{reload(){calls.reloads++}},
    },
  });
  vm.runInContext(authCode,context,{filename:'dist/auth.js'});
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const script=()=>body.children.find(e=>e.tag==='script'&&e.src==='app.js');
  return {elements,body,header,storage,data,client,calls,identity,tick,script,context};
}

test('Supabase 설정이 없으면 앱을 실행하지 않고 설정 안내',async()=>{
  const f=fixture({configured:false});await f.tick();
  assert.equal(f.script(),undefined);
  assert.equal(f.elements.get('auth-form').hidden,true);
  assert.match(f.elements.get('auth-message').textContent,/설정해 주세요/);
  assert.equal(f.body.classSet.has('auth-locked'),true);
  assert.equal(f.calls.createClient.length,0);
});
test('로그인 전에 앱 코드를 로드하지 않으며 비밀번호로 로그인 성공 시 로드',async()=>{
  const f=fixture();await f.tick();
  assert.equal(f.script(),undefined);
  assert.equal(f.elements.get('auth-form').hidden,false);
  f.elements.get('auth-email').value='user@example.com';
  f.elements.get('auth-password').value='pass123456';
  await f.elements.get('auth-form').submit();
  assert.equal(f.calls.signIn.length,1);
  assert.equal(f.calls.signIn[0].email,'user@example.com');
  assert.equal(f.calls.signIn[0].password,'pass123456');
  assert.equal(f.context.window.__oneStepAuthUserId,'test-user');
  assert.equal(f.script().src,'app.js');
  assert.equal(f.body.classSet.has('auth-locked'),true);
  f.script().onload();
  assert.equal(f.body.classSet.has('auth-locked'),false);
  assert.equal(f.elements.get('one-step-auth').wasRemoved,true);
  assert.equal(f.header.children[0].children[0].textContent,'user@example.com');
});
test('회원가입은 signUp을 쓰며 인증 세션 없이 앱을 열지 않음',async()=>{
  const f=fixture({signupSession:false});await f.tick();
  f.elements.get('auth-mode-toggle').click();
  assert.equal(f.elements.get('auth-submit').textContent,'회원가입');
  f.elements.get('auth-email').value='new@example.com';
  f.elements.get('auth-password').value='password123';
  await f.elements.get('auth-form').submit();
  assert.equal(f.calls.signUp.length,1);
  assert.equal(f.calls.signUp[0].email,'new@example.com');
  assert.equal(f.script(),undefined);
  assert.match(f.elements.get('auth-message').textContent,/이메일 확인/);
});
test('기존 로그인 세션은 사용자 확인 후 앱을 로드',async()=>{
  const f=fixture({user:{id:'test-user',email:'user@example.com'}});await f.tick();
  assert.equal(f.calls.getUser,1);
  assert.equal(f.script().src,'app.js');
});
test('예전 공용 localStorage 데이터는 사용자의 승인 전까지 건드리지 않음',async()=>{
  const old=[{id:'original',title:'예전 일'}];
  const f=fixture({user:{id:'test-user',email:'user@example.com'},legacy:old});await f.tick();
  assert.equal(f.script(),undefined);
  assert.equal(f.elements.get('auth-legacy').hidden,false);
  assert.ok(f.data.has('one-step-v1'));
  assert.equal(f.data.has('one-step-v1:test-user'),false);
  f.elements.get('auth-import').click();
  assert.equal(f.data.has('one-step-v1'),false);
  assert.deepEqual(JSON.parse(f.data.get('one-step-v1:test-user')).tasks,old);
  assert.equal(f.script().src,'app.js');
});
test('이전 기록 이동 거절 시 공용 데이터는 그대로, 계정별 신규 저장 공간 사용',async()=>{
  const f=fixture({user:{id:'test-user',email:'user@example.com'},legacy:[{id:'old'}]});await f.tick();
  f.elements.get('auth-fresh').click();
  assert.equal(f.data.has('one-step-v1'),true);
  assert.equal(f.data.has('one-step-v1:test-user'),false);
  assert.equal(f.data.get('one-step-legacy-skip:test-user'),'1');
  assert.equal(f.script().src,'app.js');
});
test('이미 계정별 저장 기록이 있으면 옛 데이터 이동 안내를 건너뜀',async()=>{
  const f=fixture({user:{id:'test-user'},legacy:[{id:'old'}],accountData:[{id:'new'}]});await f.tick();
  assert.equal(f.script().src,'app.js');
  assert.equal(f.elements.get('auth-legacy').hidden,true);
  assert.equal(f.data.has('one-step-v1'),true);
});
test('로그아웃은 현재 세션만 종료하고 페이지를 다시 잠금',async()=>{
  const f=fixture({user:{id:'test-user',email:'user@example.com'}});await f.tick();
  f.script().onload();
  const account=f.header.children[0];const button=account.children[1];
  await button.click();
  assert.equal(f.calls.signOut.length,1);
  assert.equal(f.calls.signOut[0].scope,'local');
  assert.equal(f.calls.reloads,1);
});
test('정적 HTML은 인증 잠금 후에만 app.js를 로드',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');
  assert.match(html,/<body class="auth-locked">/);
  const configIndex=html.indexOf('<script src="supabase-config.js"');
  const sdkIndex=html.indexOf('cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0');
  const authIndex=html.indexOf('<script src="auth.js"');
  assert.ok(configIndex>0&&sdkIndex>configIndex&&authIndex>sdkIndex);
  assert.equal(html.includes('<script src="app.js"'),false);
});
