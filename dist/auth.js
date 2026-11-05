'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  const authScreen = $('#auth-screen');
  const appShell = $('#app-shell');
  const notice = $('#auth-notice');
  const logout = $('#logout-btn');
  const googleButton = $('#google-login');
  const returnPath = window.location.pathname;
  let loading = false;
  let appLoaded = false;

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

  function showAuth(text = '', isError = false) {
    appShell.hidden = true;
    authScreen.hidden = false;
    $('#auth-title').textContent = '다시 만나 반가워요';
    $('#auth-description').textContent = 'Google 계정으로 로그인하세요.';
    message(text, isError);
    route('#/login');
  }

  function friendlyError(error) {
    const code = error && error.code;
    if (code === 'over_request_rate_limit') {
      return '요청이 많아요. 잠시 후 다시 시도해 주세요.';
    }
    return '로그아웃을 완료하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
  }

  function isGoogleAccount(user) {
    if (!user) return false;
    const metadata = user.app_metadata || {};
    const providers = Array.isArray(metadata.providers) ? metadata.providers : [];
    const identities = Array.isArray(user.identities) ? user.identities : [];
    return metadata.provider === 'google' || providers.includes('google')
      || identities.some((identity) => identity.provider === 'google');
  }

  function showApp(user) {
    if (!user || !user.id || !user.email) {
      showAuth('로그인 정보를 확인할 수 없습니다.', true);
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
      showAuth('앱을 불러오지 못했어요. 페이지를 새로고침해 주세요.', true);
    };
    document.body.append(script);
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    showAuth('로그인 프로그램을 불러올 수 없어요. 인터넷 연결을 확인하고 새로고침해 주세요.', true);
    googleButton.disabled = true;
    return;
  }

  const client = window.supabase.createClient(
    'https://npjghhsafqvchfpitigk.supabase.co',
    'sb_publishable_rNStYvHkIbQMhT3MSUv8XA_-oQsF7_F',
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'one-step-auth-v1' } }
  );

  googleButton.disabled = false;
  googleButton.addEventListener('click', async () => {
    if (loading) return;
    loading = true;
    googleButton.disabled = true;
    message('');
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;
    } catch {
      message('Google 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.', true);
      loading = false;
      googleButton.disabled = false;
    }
  });

  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && appLoaded) {
      appShell.hidden = true;
      window.location.replace(returnPath + '#/login');
      window.location.reload();
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
    showAuth();
  });

  (async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('error') || params.has('error_code')) {
        const errorCode = params.get('error_code') || params.get('error');
        window.history.replaceState(null, '', returnPath + '#/login');
        showAuth(errorCode === 'access_denied'
          ? 'Google 로그인이 취소되었어요. 다시 시도해 주세요.'
          : 'Google 로그인을 완료하지 못했어요. 로그인 설정을 확인하고 다시 시도해 주세요.', true);
        return;
      }
      const { data, error } = await client.auth.getUser();
      if (data && data.user && !error && isGoogleAccount(data.user)) {
        showApp(data.user);
      } else if (data && data.user && !isGoogleAccount(data.user)) {
        await client.auth.signOut();
        showAuth('Google 계정으로 다시 로그인해 주세요.');
      } else {
        const hasError = !!error && error.message !== 'Auth session missing!';
        showAuth(hasError ? '로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.' : '', hasError);
      }
    } catch {
      showAuth('서버에 연결하지 못했어요. 다시 시도해 주세요.', true);
    }
  })();
})();
