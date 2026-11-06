'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');

function fixture(today='2026-11-04',user='account-A',sharedStorage){
  let seq=0;
  const storage=sharedStorage||new Map();
  const elements=new Map();
  const el=selector=>{
    if(!elements.has(selector))elements.set(selector,{
      value:selector==='#filter'?'any':selector==='#sort'?'created':'',
      textContent:'',innerHTML:'',hidden:false,style:{},dataset:{},
      classList:{toggle(){}},addEventListener(){},focus(){},close(){},showModal(){}
    });
    return elements.get(selector);
  };
  const document={querySelector:el,querySelectorAll:()=>[],addEventListener(){}};
  const NativeDate=Date;
  class FixedDate extends NativeDate{
    constructor(...args){super(...(args.length?args:[`${today}T12:00:00`]))}
    static now(){return new NativeDate(`${today}T12:00:00`).getTime()}
  }
  const localStorage={
    getItem:k=>storage.has(k)?storage.get(k):null,
    setItem:(k,v)=>storage.set(k,String(v)),
    removeItem:k=>storage.delete(k),
  };
  const context=vm.createContext({
    document,localStorage,window:{__oneStepAuthUserId:user},
    crypto:{randomUUID:()=>`new-${++seq}`},
    Date:FixedDate,Intl,
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,
  });
  vm.runInContext(`${code}\n;globalThis.__test={nextRepeatDue,complete,newTask,state,dateKey};`,context,{filename:'dist/app.js'});
  return {app:context.__test,storage,el};
}
function task(app,{due='2026-11-04',repeat='weekly',status='todo'}={}){
  const t=app.newTask('테스트 작업');
  t.due=due;t.repeat=repeat;t.status=status;
  t.steps=[{id:'step1',title:'단계 1',done:true},{id:'step2',title:'단계 2',done:false}];
  t.reminder='2026-11-04T09:00';t.notified='2026-11-04T09:00';t.today=true;
  app.state.tasks.push(t);
  return t;
}

const cases=[
  ['매일 정시 완료','2026-11-04','daily','2026-11-05'],
  ['매주 정시 완료','2026-11-04','weekly','2026-11-11'],
  ['매일 기존 다음 날짜가 미래','2026-11-10','daily','2026-11-11'],
  ['매주 기존 다음 날짜가 미래','2026-11-10','weekly','2026-11-17'],
  ['매일 장기 지연','2026-10-01','daily','2026-11-05'],
  ['매주 장기 지연 (재현 사례)','2026-10-01','weekly','2026-11-05'],
  ['매일 다음 반복일이 완료일과 같은 날','2026-11-03','daily','2026-11-05'],
  ['매주 다음 반복일이 완료일과 같은 날','2026-10-28','weekly','2026-11-11'],
  ['마감일 없는 매일 반복','','daily','2026-11-05'],
  ['마감일 없는 매주 반복','','weekly','2026-11-11'],
];
for(const [name,due,repeat,expected] of cases){
  test(name,()=>{
    const {app,storage}=fixture();const t=task(app,{due,repeat});
    const originalId=t.id;
    app.complete(t);
    assert.equal(app.state.tasks.length,2);
    assert.equal(t.status,'done');
    assert.equal(t.completed,'2026-11-04');
    assert.equal(t.due,due);
    const next=app.state.tasks[1];
    assert.equal(next.due,expected);
    assert.equal(next.start,expected);
    assert.equal(next.status,'todo');
    assert.equal(next.today,false);
    assert.equal(next.completed,'');
    assert.notEqual(next.id,originalId);
    assert.notEqual(next.steps[0].id,t.steps[0].id);
    assert.equal(next.steps[0].done,false);
    assert.equal(next.reminder,'');
    assert.equal(next.notified,'');
    assert.ok(storage.has('one-step-v1:account-A'));
    assert.equal(storage.has('one-step-v1'),false);
  });
}
test('월말, 윤년, 연말, 오래된 일정을 날짜 주기로 계산',()=>{
  const {app}=fixture('2024-03-02');
  assert.equal(app.nextRepeatDue('2024-02-28','daily','2024-03-02'),'2024-03-03');
  assert.equal(app.nextRepeatDue('2026-12-24','weekly','2027-01-01'),'2027-01-07');
  assert.equal(app.nextRepeatDue('2026-01-31','daily','2026-02-01'),'2026-02-02');
  const actual=app.nextRepeatDue('2000-01-01','weekly','2026-11-04');
  assert.ok(actual>'2026-11-04');
  const days=(Date.parse(`${actual}T00:00:00Z`)-Date.parse('2000-01-01T00:00:00Z'))/86400000;
  assert.equal(days%7,0);
});
test('비반복 작업 완료 시 복제 생성하지 않음',()=>{
  const {app}=fixture();const t=task(app,{repeat:'none'});
  app.complete(t);
  assert.equal(app.state.tasks.length,1);
  assert.equal(t.status,'done');
});
test('반복 완료 실행 취소는 원본 작업과 새 작업 생성 모두 복원',()=>{
  const {app,el,storage}=fixture();const t=task(app,{due:'2026-10-01',repeat:'weekly'});
  const before=JSON.stringify(app.state.tasks);
  app.complete(t);
  assert.equal(app.state.tasks.length,2);
  assert.equal(typeof el('#undo').onclick,'function');
  el('#undo').onclick();
  assert.equal(JSON.stringify(app.state.tasks),before);
  assert.equal(storage.get('one-step-v1:account-A'),JSON.stringify(app.state));
});
test('완료된 작업의 완료 취소는 다음 복제본을 추가로 만들지 않음',()=>{
  const {app}=fixture();const t=task(app,{due:'2026-10-01'});
  app.complete(t);
  assert.equal(app.state.tasks.length,2);
  app.complete(t);
  assert.equal(t.status,'todo');
  assert.equal(t.completed,'');
  assert.equal(app.state.tasks.length,2);
});
test('계정별 localStorage 분리',()=>{
  const shared=new Map();
  const accountA=fixture('2026-11-04','account-A',shared);
  const t=task(accountA.app);accountA.app.complete(t);
  const accountB=fixture('2026-11-04','account-B',shared);
  assert.ok(shared.has('one-step-v1:account-A'));
  assert.equal(accountB.app.state.tasks.length,0);
  const reloadedA=fixture('2026-11-04','account-A',shared);
  assert.equal(reloadedA.app.state.tasks.length,2);
});
