'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  const authScreen = $('#auth-screen');
  const appShell = $('#app-shell');
  const form = $('#auth-form');
  const notice = $('#auth-notice');
  const submit = $('#auth-submit');
  const emailField = $('#auth-email-field');
  const passwordField = $('#auth-password-field');
  const emailInput = $('#auth-email');
  const passwordInput = $('#auth-password');
  const logout = $('#logout-btn');
  const returnPath = window.location.pathname + window.location.search;
  let mode = 'login';
  let loading = false;
  let appLoaded = false;
  let recovery = false;

  function route(hash) {
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', returnPath + hash);
    }
  }

  function message(text, isError = false) {
    notice.hidden = !text;
    notice.textContent = text || '';
    notice.classList.toggle('is-error', isError);
  }

  function showAuth(nextMode = 'login', text = '', isError = false) {
    mode = nextMode;
    appShell.hidden = true;
    authScreen.hidden = false;
    const headings = {
      login: ['다시 만나 반가워요', '이메일과 비밀번호로 로그인하세요.', '로그인'],
      signup: ['한 걸음 시작하기', '이메일로 계정을 만들고 시작하세요.', '회원가입'],
      forgot: ['비밀번호 찾기', '재설정 링크를 이메일로 보내드려요.', '재설정 메일 받기'],
      recovery: ['새 비밀번호 설정', '새 비밀번호를 입력해 주세요.', '비밀번호 변경']
    };
    const item = headings[mode] || headings.login;
    $('#auth-title').textContent = item[0];
    $('#auth-description').textContent = item[1];
    submit.textContent = item[2];
    emailField.hidden = mode === 'recovery';
    passwordField.hidden = mode === 'forgot';
    passwordInput.autocomplete = mode === 'signup' || mode === 'recovery' ? 'new-password' : 'current-password';
    passwordInput.required = mode !== 'forgot';
    emailInput.required = mode !== 'recovery';
    passwordInput.value = '';
    document.querySelectorAll('[data-auth-mode]').forEach((button) => {
      button.hidden = mode === 'recovery' || button.dataset.authMode === mode;
    });
    message(text, isError);
    route(mode === 'signup' ? '#/signup' : mode === 'forgot' ? '#/forgot-password' : mode === 'recovery' ? '#/reset-password' : '#/login');
  }

  function friendlyError(error) {
    const code = error && error.code;
    const text = (error && error.message) || '';
    if (code === 'invalid_credentials' || /Invalid login credentials/i.test(text)) {
      return '이메일 또는 비밀번호가 올바르지 않아요.';
    }
    if (code === 'email_not_confirmed' || /Email not confirmed/i.test(text)) {
      return '먼저 이메일에 도착한 확인 링크를 눌러주세요.';
    }
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
      return '요청이 많아요. 잠시 후 다시 시도해 주세요.';
    }
    if (code === 'weak_password' || /Password should be at least/i.test(text)) {
      return '비밀번호는 8자 이상으로 설정해 주세요.';
    }
    return '요청을 처리하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
  }

  function showApp(user) {
    if (!user || !user.id || !user.email) {
      showAuth('login', '로그인 정보를 확인할 수 없습니다.', true);
      return;
    }
    if (appLoaded) {
      if (window.__ONE_STEP_USER_ID !== user.id) window.location.reload();
      return;
    }
    window.__ONE_STEP_USER_ID = user.id;
    window.__ONE_STEP_STORAGE_KEY = 'one-step-v2:' + user.id;
    window.__ONE_STEP_DRAFT_KEY = 'one-step-draft-v2:' + user.id;
    $('#account-email').textContent = user.email;
    route('#/app');
    authScreen.hidden = true;
    appShell.hidden = false;
    appLoaded = true;
    const script = document.createElement('script');
    script.src = 'app.js';
    script.onerror = () => {
      appLoaded = false;
      showAuth('login', '앱을 불러오지 못했어요. 페이지를 새로고침해 주세요.', true);
    };
    document.body.append(script);
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    showAuth('login', '로그인 프로그램을 불러올 수 없어요. 인터넷 연결을 확인하고 새로고침해 주세요.', true);
    submit.disabled = true;
    return;
  }

  const client = window.supabase.createClient(
    'https://npjghhsafqvchfpitigk.supabase.co',
    'sb_publishable_rNStYvHkIbQMhT3MSUv8XA_-oQsF7_F',
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'one-step-auth-v1' } }
  );

  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      recovery = true;
      showAuth('recovery', '새 비밀번호를 설정하면 다시 로그인할 수 있어요.');
    }
    if (event === 'SIGNED_OUT' && appLoaded) {
      appShell.hidden = true;
      window.location.replace(returnPath + '#/login');
      window.location.reload();
    }
  });

  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => showAuth(button.dataset.authMode));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (loading) return;
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (mode !== 'recovery' && !emailInput.validity.valid) {
      message('올바른 이메일 주소를 입력해 주세요.', true);
      return;
    }
    if (mode !== 'forgot' && password.length < 8) {
      message('비밀번호는 8자 이상 입력해 주세요.', true);
      return;
    }
    loading = true;
    submit.disabled = true;
    message('');
    try {
      if (mode === 'login') {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data || !data.user || !data.session) throw Error('No active session');
        showApp(data.user);
      } else if (mode === 'signup') {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + window.location.pathname + '#/app' }
        });
        if (error) throw error;
        if (data && data.session && data.user) {
          showApp(data.user);
        } else {
          showAuth('login', '확인 이메일을 보냈어요. 메일에서 계정 확인을 마친 뒤 로그인해 주세요.');
        }
      } else if (mode === 'forgot') {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname + '#/reset-password'
        });
        if (error) throw error;
        showAuth('login', '재설정 이메일을 요청했어요. 받은 편지함을 확인해 주세요.');
      } else if (mode === 'recovery') {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        recovery = false;
        await client.auth.signOut();
        showAuth('login', '비밀번호를 변경했어요. 새 비밀번호로 로그인해 주세요.');
      }
    } catch (error) {
      message(friendlyError(error), true);
    } finally {
      loading = false;
      submit.disabled = false;
    }
  });

  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      appShell.hidden = true;
      window.location.replace(returnPath + '#/login');
      window.location.reload();
    } catch (error) {
      logout.disabled = false;
      const toast = $('#toast');
      if (toast) {
        toast.hidden = false;
        toast.textContent = friendlyError(error);
      }
    }
  });

  window.addEventListener('hashchange', () => {
    if (appLoaded) {
      route('#/app');
      return;
    }
    if (!recovery) {
      const hash = window.location.hash;
      showAuth(hash === '#/signup' ? 'signup' : hash === '#/forgot-password' ? 'forgot' : 'login');
    }
  });

  (async () => {
    try {
      const { data, error } = await client.auth.getUser();
      if (recovery) return;
      if (data && data.user && !error) {
        showApp(data.user);
      } else {
        const hash = window.location.hash;
        showAuth(hash === '#/signup' ? 'signup' : hash === '#/forgot-password' ? 'forgot' : 'login',
          error && error.message !== 'Auth session missing!' ? '로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.' : '',
          !!error && error.message !== 'Auth session missing!');
      }
    } catch {
      if (!recovery) showAuth('login', '서버에 연결하지 못했어요. 다시 시도해 주세요.', true);
    }
  })();
})();
