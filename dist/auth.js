// Supabase Auth gate: no task code runs until a user is authenticated.
(() => {
  'use strict';
  const config=window.ONE_STEP_SUPABASE||{};
  const root=document.createElement('main');
  root.id='one-step-auth';
  root.innerHTML=`
    <style>
      #one-step-auth{position:fixed;inset:0;z-index:9999;overflow-y:auto;display:grid;place-items:center;padding:24px;background:#f5f7fd;color:#202b47;font-family:system-ui,-apple-system,sans-serif}
      #one-step-auth .auth-card{box-sizing:border-box;width:min(100%,430px);background:#fff;border:1px solid #e3e9f4;border-radius:22px;box-shadow:0 16px 48px #283c7018;padding:36px}
      #one-step-auth h1{font-size:30px;margin:0 0 8px;color:#394eb6}
      #one-step-auth p{line-height:1.55;color:#526078}
      #one-step-auth label{display:block;font-size:14px;font-weight:650;margin:16px 0 7px}
      #one-step-auth input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #b8c2da;border-radius:10px;font-size:16px;background:white;color:#202b47}
      #one-step-auth button{cursor:pointer;font:inherit}
      #one-step-auth .auth-primary{width:100%;margin-top:20px;border:0;border-radius:11px;background:#4565db;color:white;padding:13px;font-weight:700}
      #one-step-auth .auth-primary:disabled{opacity:.55;cursor:wait}
      #one-step-auth .auth-secondary{border:0;color:#3b58cd;background:transparent;padding:12px 0}
      #one-step-auth #auth-message{min-height:1.5em;font-size:14px}
      #one-step-auth #auth-message.error{color:#ba2e40}
      #one-step-auth [hidden]{display:none!important}
      #one-step-auth .auth-warning{font-size:13px;background:#f5f7fd;border-radius:10px;padding:12px}
      #one-step-auth #auth-legacy .auth-primary{margin-top:8px}
    </style>
    <section class="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">한걸음.</h1>
      <p id="auth-description">나만의 한 걸음을 기록하려면 로그인하세요.</p>
      <form id="auth-form" hidden>
        <label for="auth-email">이메일</label><input id="auth-email" type="email" autocomplete="email" required>
        <label for="auth-password">비밀번호</label><input id="auth-password" type="password" autocomplete="current-password" minlength="6" required>
        <button id="auth-submit" class="auth-primary" type="submit">로그인</button>
        <button id="auth-mode-toggle" class="auth-secondary" type="button">계정이 없나요? 회원가입</button>
      </form>
      <div id="auth-legacy" hidden>
        <p class="auth-warning">이 브라우저에 로그인 전에 저장된 할 일이 있습니다. 이 계정으로 이동하면 기존 공용 저장 공간에서는 삭제됩니다. 이동하지 않고 새로 시작할 수도 있습니다.</p>
        <button id="auth-import" class="auth-primary" type="button">기존 기록을 이 계정으로 이동</button>
        <button id="auth-fresh" class="auth-secondary" type="button">이동하지 않고 새로 시작</button>
      </div>
      <p id="auth-message" role="status" aria-live="polite"></p>
    </section>`;
  document.body.append(root);
  const $=s=>root.querySelector(s);
  const form=$('#auth-form'),migration=$('#auth-legacy'),submit=$('#auth-submit');
  let mode='login',client=null,started=false,redirecting=false,pendingUser=null;
  function status(message,isError=false){const el=$('#auth-message');el.textContent=message;el.classList.toggle('error',isError)}
  function showForm(){migration.hidden=true;form.hidden=false;$('#auth-description').textContent='나만의 한 걸음을 기록하려면 로그인하세요.'}
  function reloadOnce(){if(!redirecting){redirecting=true;window.location.reload()}}
  function launch(user){
    if(started||!user||typeof user.id!=='string'||!user.id)return;
    pendingUser=user;
    const key=`one-step-v1:${user.id}`;
    try{
      const old=localStorage.getItem('one-step-v1');
      if(!localStorage.getItem(key)&&!localStorage.getItem(`one-step-legacy-skip:${user.id}`)&&old&&Array.isArray(JSON.parse(old).tasks)){
        form.hidden=true;migration.hidden=false;
        $('#auth-description').textContent='이전 기록을 어떻게 처리할까요?';
        status('기록은 선택하기 전까지 변경되지 않습니다.');
        return;
      }
    }catch{/* Storage access can be unavailable. App shows its existing warning. */}
    started=true;
    window.__oneStepAuthUserId=user.id;
    const script=document.createElement('script');
    script.src='app.js';
    script.onload=()=>{
      const account=document.createElement('div');account.id='auth-account';
      account.style.display='flex';account.style.alignItems='center';account.style.gap='8px';account.style.fontSize='12px';
      const email=document.createElement('span');email.textContent=user.email||'로그인됨';
      email.style.maxWidth='180px';email.style.overflow='hidden';email.style.textOverflow='ellipsis';email.style.whiteSpace='nowrap';
      const signout=document.createElement('button');signout.type='button';signout.textContent='로그아웃';
      signout.style.border='1px solid #c9d2e7';signout.style.borderRadius='8px';signout.style.padding='6px 10px';
      signout.style.background='transparent';signout.style.color='#394eb6';signout.style.cursor='pointer';
      signout.addEventListener('click',async()=>{
        signout.disabled=true;
        try{
          const {error}=await client.auth.signOut({scope:'local'});
          if(error)throw error;
          reloadOnce();
        }catch{signout.disabled=false;signout.textContent='로그아웃 재시도'}
      });
      account.append(email,signout);
      document.querySelector('header').append(account);
      document.body.classList.remove('auth-locked');
      root.remove();
    };
    script.onerror=()=>{started=false;status('앱 스크립트를 불러오지 못했습니다. 새로고침해 주세요.',true)};
    document.body.append(script);
  }
  $('#auth-import').addEventListener('click',()=>{
    if(!pendingUser)return;
    try{
      const target=`one-step-v1:${pendingUser.id}`,legacy=localStorage.getItem('one-step-v1');
      const parsed=JSON.parse(legacy);
      if(!Array.isArray(parsed.tasks)||localStorage.getItem(target))throw Error();
      localStorage.setItem(target,legacy);
      const oldDraft=localStorage.getItem('one-step-draft');
      if(oldDraft) localStorage.setItem(`one-step-draft:${pendingUser.id}`,oldDraft);
      // Delete legacy data only after the user expressly chooses to move it.
      localStorage.removeItem('one-step-v1');
      localStorage.removeItem('one-step-draft');
      launch(pendingUser);
    }catch{status('기록을 옮기지 못했습니다. 브라우저 저장 공간을 확인해 주세요.',true)}
  });
  $('#auth-fresh').addEventListener('click',()=>{
    if(!pendingUser)return;
    try{localStorage.setItem(`one-step-legacy-skip:${pendingUser.id}`,'1')}catch{}
    launch(pendingUser);
  });
  $('#auth-mode-toggle').addEventListener('click',()=>{
    mode=mode==='login'?'signup':'login';
    $('#auth-submit').textContent=mode==='login'?'로그인':'회원가입';
    $('#auth-mode-toggle').textContent=mode==='login'?'계정이 없나요? 회원가입':'이미 계정이 있나요? 로그인';
    $('#auth-password').autocomplete=mode==='login'?'current-password':'new-password';
    status('');
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const email=$('#auth-email').value.trim(),password=$('#auth-password').value;
    submit.disabled=true;status('처리 중...');
    try{
      const result=mode==='login'
        ?await client.auth.signInWithPassword({email,password})
        :await client.auth.signUp({email,password});
      if(result.error)throw result.error;
      if(result.data?.session?.user){status('');launch(result.data.session.user)}
      else if(mode==='signup')status('가입되었습니다. 이메일 확인이 필요한 설정이라면 확인을 마친 뒤 로그인해 주세요.');
      else status('로그인 상태를 확인할 수 없습니다. 다시 시도해 주세요.',true);
    }catch{status(mode==='login'?'로그인에 실패했습니다. 이메일과 비밀번호를 확인해 주세요.':'회원가입에 실패했습니다. 입력 정보와 Supabase 설정을 확인해 주세요.',true)}
    finally{submit.disabled=false}
  });
  const url=typeof config.url==='string'?config.url.trim():'';
  const key=typeof config.publishableKey==='string'?config.publishableKey.trim():'';
  const safeKey=key.startsWith('sb_publishable_')||(key.startsWith('eyJ')&&key.split('.').length===3);
  if(!/^https:\/\/[^/]+\/?$/.test(url)||!safeKey||key.includes('...')){
    status('Supabase 프로젝트 URL과 공개용 publishable 키를 supabase-config.js에 설정해 주세요.',true);
    return;
  }
  if(!window.supabase||typeof window.supabase.createClient!=='function'){
    status('Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.',true);
    return;
  }
  try{client=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})}
  catch{status('Supabase 초기화에 실패했습니다. 설정을 확인해 주세요.',true);return}
  client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'&&started)reloadOnce()});
  (async()=>{
    try{
      const {data,error}=await client.auth.getUser();
      if(data?.user){launch(data.user);return}
      showForm();
      if(error&&error.name!=='AuthSessionMissingError')status('로그인 상태를 확인할 수 없습니다. 인터넷 연결을 확인해 주세요.',true);
      else status('');
    }catch{showForm();status('로그인 상태 확인에 실패했습니다. 인터넷 연결을 확인해 주세요.',true)}
  })();
})();
