/* ОКТО · личный кабинет — аккаунты, курсы, задания, журнал прогресса.
   Режим по умолчанию — демо: всё хранится только в этом браузере (localStorage).
   Пароль сохраняется исключительно как SHA-256 с солью через Web Crypto.
   Точка подключения серверного хранилища — ADAPTER (см. конец файла):
   страницы не переписываются, достаточно заменить ADAPTER.backend. */
(() => {
  'use strict';

  const PREFIX = 'okto-account-';
  const DAY = 24 * 60 * 60 * 1000;

  const TEXT = {
    demoNote: 'Демо-режим: данные хранятся только в этом браузере. Для общего входа нужен подключённый сервис аккаунтов.',
    sessionNote: 'Вы вошли по локальной демо-сессии — данные видны только в этом браузере.',
    storageBlocked: 'Браузер не даёт сохранять данные (приватный режим?). Вход и отправка форм невозможны — освободите хранилище сайта и обновите страницу.',
    cryptoBlocked: 'Не удалось вычислить хеш пароля. Откройте сайт по адресу http://localhost или через файл? Web Crypto доступен только на страницах file:// и http://localhost, но не на обычном http.',
    invalidCredentials: 'Неверный email или пароль.',
    emailTaken: 'Такой email уже зарегистрирован. Войдите или укажите другой адрес.',
    forgotHint: 'Восстановления пароля в демо-режиме нет: зарегистрируйте новый адрес.',
    forgotEmail: 'Введите email в поле выше — пришлём ссылку для сброса пароля.',
    forgotSent: 'Если такой адрес зарегистрирован, письмо со ссылкой для сброса пароля уже отправлено.',
    checkEmail: 'Аккаунт создан. Мы отправили письмо на вашу почту — перейдите по ссылке из него, чтобы подтвердить адрес, затем войдите. Письмо может попасть в «Спам».',
    confirmEmail: 'Почта ещё не подтверждена. Откройте письмо от сервиса и перейдите по ссылке, затем войдите снова.',
    serverError: 'Не удалось связаться с сервисом аккаунтов. Проверьте интернет и попробуйте ещё раз через минуту.',
    weakPassword: 'Сервис отклонил пароль: придумайте пароль посложнее (минимум 8 символов).',
    rateLimited: 'Слишком много попыток подряд. Подождите несколько минут и попробуйте снова.',
  };

  const STATUS = {
    review: { label: 'на проверке', className: 'is-review' },
    accepted: { label: 'принято', className: 'is-accepted' },
    rework: { label: 'нужна доработка', className: 'is-rework' },
    open: { label: 'не отправлено', className: 'is-open' },
  };

  const isBrowser = typeof window !== 'undefined';
  const SHOW_DIAG = (() => { try { return window.localStorage.getItem('okto-show-diag') === '1'; } catch { return false; } })();
  const diag = (text) => {
    if (!SHOW_DIAG) return;
    try {
      let box = document.getElementById('js-diag');
      if (!box) { box = document.createElement('div'); box.id = 'js-diag'; box.style.cssText = 'position:fixed;left:12px;bottom:12px;right:12px;z-index:99;padding:10px 14px;border-radius:8px;background:#fff6d6;border:1px solid #b58b00;font:12px/1.45 monospace;white-space:pre-wrap'; document.body.appendChild(box); }
      box.textContent = text;
    } catch { /* ignore */ }
  };
  if (isBrowser) window.addEventListener('error', (event) => diag('Ошибка: ' + event.message + ' (' + (event.filename || '').split('/').pop() + ':' + event.lineno + ')'));
  let storageAvailable = true;

  const read = (key, fallback) => {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch {
      return fallback;
    }
  };

  const write = (key, value) => {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      storageAvailable = true;
      return true;
    } catch {
      storageAvailable = false;
      return false;
    }
  };

  const wipe = () => {
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith(PREFIX))
        .forEach((key) => window.localStorage.removeItem(key));
    } catch { /* storage unavailable */ }
  };

  const uid = () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const toHex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  const sha256 = async (text) => {
    const bytes = new TextEncoder().encode(text);
    return toHex(await window.crypto.subtle.digest('SHA-256', bytes));
  };

  const randomSalt = () => {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return toHex(bytes);
  };

  const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zа-я]{2,}$/i;
  const validEmail = (value) => EMAIL_RE.test(normalizeEmail(value));

  const normalizeUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.protocol + '//' + parsed.host + parsed.pathname + parsed.search + parsed.hash : '';
    } catch {
      return '';
    }
  };
  const validUrl = (value) => normalizeUrl(value) !== '';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  const formatDate = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    try {
      return date.toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    } catch {
      return date.toISOString().slice(0, 16).replace('T', ' ');
    }
  };

  const plural = (count, one, few, many) => {
    const mod100 = Math.abs(count) % 100;
    const mod10 = mod100 % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  };

  /* ---------- служебное состояние страниц ---------- */

  const notify = (message, tone = 'info') => {
    const box = document.querySelector('#account-status');
    if (!box) return;
    box.textContent = message || '';
    box.dataset.tone = tone;
    box.hidden = !message;
  };

  const fieldError = (field, message) => {
    const holder = document.querySelector(`[data-error-for="${field}"]`);
    const input = document.querySelector(`#${field}`);
    if (holder) {
      holder.textContent = message || '';
      holder.hidden = !message;
    }
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  };

  const clearErrors = (form) => {
    if (!form) return;
    form.querySelectorAll('[data-error-for]').forEach((holder) => {
      holder.textContent = '';
      holder.hidden = true;
    });
    form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
  };

  const busy = (form, isBusy, label) => {
    if (!form) return;
    form.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    form.querySelectorAll('button[type="submit"]').forEach((button) => {
      if (isBusy) {
        if (!button.dataset.label) button.dataset.label = button.textContent;
        button.disabled = true;
        button.textContent = label || 'Отправляем…';
      } else {
        button.disabled = false;
        if (button.dataset.label) button.textContent = button.dataset.label;
      }
    });
  };

  /* ---------- адаптер хранилища: демо (localStorage) ---------- */

  const store = {
    read,
    write,
    wipe,
  };

  const SEED_COURSE = {
    id: 'jung-character',
    title: 'Юнгианский анализ театрального персонажа',
    level: 'Начальный',
    description: 'Практический курс о том, как читать сценический текст через юнгианские понятия и проверять интерпретации в действии, а не превращать их в диагнозы.',
    lessons: 8,
    url: '../../courses/jung-character/index.html',
    published: true,
    createdAt: '2026-01-10T10:00:00.000Z',
  };

  const DEMO_BACKEND = {
    kind: 'demo',
    async ensureSeed() {
      const courses = store.read('courses', []);
      if (courses.length) return courses;
      store.write('courses', [SEED_COURSE]);
      const users = store.read('users', []);
      if (!users.some((user) => user.id === 'demo-curator')) {
        users.push({
          id: 'demo-curator',
          name: 'Куратор ОКТО',
          email: 'curator@okto.demo',
          role: 'curator',
          salt: '00000000000000000000000000000000',
          hash: '',
          demo: true,
          createdAt: '2026-01-10T10:00:00.000Z',
        });
        store.write('users', users);
      }
      return store.read('courses', []);
    },
    users: () => store.read('users', []),
    saveUsers: (users) => store.write('users', users),
    courses: () => store.read('courses', [SEED_COURSE]),
    saveCourses: (courses) => store.write('courses', courses),
    submissions: () => store.read('submissions', []),
    saveSubmissions: (items) => store.write('submissions', items),
    progress: () => store.read('progress', {}),
    saveProgress: (progress) => store.write('progress', progress),
    session: () => store.read('session', null),
    saveSession: (session) => store.write('session', session),
  };

  const ADAPTER = {
    backend: DEMO_BACKEND,
    get mode() { return this.backend.kind; },
    get isDemo() { return !serverMode(); },
    note() { return this.isDemo ? TEXT.demoNote : ''; },
  };

  /* ---------- живой прогресс: отметки на странице курса (site.js) ---------- */

  const courseProgressLink = (course) => {
    if (!course || !course.id) return 0;
    try {
      const raw = JSON.parse(window.localStorage.getItem(`okto-progress-${course.id}`) || 'null');
      return Array.isArray(raw) ? raw.length : 0;
    } catch {
      return 0;
    }
  };

  const percentOf = (done, total) => {
    const all = Number(total) || 0;
    if (!all) return 0;
    return Math.max(0, Math.min(100, Math.round((Number(done) / all) * 100)));
  };

  /* ---------- сервер аккаунтов (Supabase) ----------
     Пока ключи в assets/config.js пустые, supa = null и весь кабинет
     работает в прежнем демо-режиме. После заполнения ключей включается
     серверный режим без изменения страниц. */

  const SUPA_CFG = window.OKTO_CONFIG || {};
  let supa = null;
  if (SUPA_CFG.supabaseUrl && SUPA_CFG.supabaseAnonKey && window.supabase?.createClient) {
    try {
      supa = window.supabase.createClient(SUPA_CFG.supabaseUrl, SUPA_CFG.supabaseAnonKey);
    } catch (error) {
      supa = null;
      console.error('[ОКТО] клиент базы не создан', error);
    }
  }
  if (isBrowser) {
    diag(
      'Библиотека: ' + (window.supabase?.createClient ? 'загружена' : 'НЕ загружена')
      + ' | адрес базы: ' + (SUPA_CFG.supabaseUrl ? 'есть' : 'нет')
      + ' | ключ: ' + (SUPA_CFG.supabaseAnonKey ? 'есть' : 'нет')
      + ' | режим: ' + (supa ? 'сервер' : 'демо')
      + ' | библиотека в браузере: ' + (window.supabase ? 'да' : 'нет')
    );
  }

  const serverMode = () => Boolean(supa) || useRaw();
  const serverSession = () => (window.__oktoSession || {}).session?.user || null;
  /* ---------- резервный вход без библиотеки ----------
     Если внешняя библиотека не загрузилась, входим напрямую через REST API:
     регистрация, вход по паролю и сессия в localStorage. */
  const RAW_SESSION = 'okto-raw-session';
  const useRaw = () => !supa && Boolean(SUPA_CFG.supabaseUrl && SUPA_CFG.supabaseAnonKey && typeof fetch === 'function');

  const rawAuth = {
    endpoint(path) { return SUPA_CFG.supabaseUrl.replace(/\/+$/, '') + '/auth/v1' + path; },
    headers() { return { apikey: SUPA_CFG.supabaseAnonKey, 'Content-Type': 'application/json' }; },
    async call(path, options = {}) {
      const response = await fetch(this.endpoint(path), { method: 'POST', headers: this.headers(), body: JSON.stringify(options.body || {}) });
      let data = null;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) throw Object.assign(new Error('raw'), { status: response.status, data });
      return data;
    },
    read() { try { return JSON.parse(window.localStorage.getItem(RAW_SESSION) || 'null'); } catch { return null; } },
    write(value) {
      try {
        if (value) window.localStorage.setItem(RAW_SESSION, JSON.stringify(value));
        else window.localStorage.removeItem(RAW_SESSION);
      } catch { /* storage unavailable */ }
    },
    user() {
      const stored = this.read();
      if (!stored?.session?.user) return null;
      const meta = stored.session.user.user_metadata || {};
      return { id: stored.session.user.id, name: meta.name || stored.session.user.email || 'участник', email: stored.session.user.email || '', role: meta.role === 'curator' ? 'curator' : 'participant' };
    },
    sessionListener: null,
  };
  const syncServerSession = async () => {
    if (!supa) return null;
    const { data } = await supa.auth.getSession();
    window.__oktoSession = data || null;
    window.__oktoProfile = null;
    const authUser = data?.session?.user;
    if (authUser) {
      const { data: profile } = await supa.from('profiles').select('id,name,role').eq('id', authUser.id).maybeSingle();
      window.__oktoProfile = profile || null;
    }
    return currentUser();
  };

  const toCourse = (row) => ({
    id: row.id,
    title: row.title,
    level: row.level,
    description: row.description,
    lessons: Number(row.lessons) || 1,
    url: row.url || '',
    published: Boolean(row.published),
    createdAt: row.created_at,
  });

  const toSubmission = (row, names) => ({
    id: row.id,
    userId: row.user_id,
    userName: (names && names.get(row.user_id)) || 'участник',
    courseId: row.course_id,
    courseTitle: '',
    lessonIndex: Number(String(row.lesson || '').replace(/\D+/g, '')) || 1,
    text: row.text_body || '',
    url: row.link || '',
    status: row.status === 'accepted' || row.status === 'rework' ? row.status : 'review',
    createdAt: row.created_at,
    checkedAt: row.reviewed_at,
    checkedBy: null,
  });

  const serverCourses = async () => {
    const { data, error } = await supa.from('courses').select('*').order('created_at', { ascending: true });
    if (error) throw new Error('server');
    return (data || []).map(toCourse);
  };

  const serverSubmissions = async () => {
    const { data, error } = await supa.from('submissions').select('*').order('created_at', { ascending: false });
    if (error) throw new Error('server');
    const { data: profiles } = await supa.from('profiles').select('id,name');
    const names = new Map((profiles || []).map((row) => [row.id, row.name]));
    return (data || []).map((row) => toSubmission(row, names));
  };

  /* ---------- сессия и пользователи ---------- */

  const findUser = (email) => ADAPTER.backend.users().find((user) => user.email === normalizeEmail(email));

  const currentUser = () => {
    if (useRaw()) return rawAuth.user();
    if (supa) {
      const authUser = serverSession();
      if (!authUser) return null;
      const meta = authUser.user_metadata || {};
      const profile = window.__oktoProfile || {};
      const role = (profile.role || meta.role) === 'curator' ? 'curator' : 'participant';
      return { id: authUser.id, name: profile.name || meta.name || authUser.email || 'участник', email: authUser.email || '', role };
    }
    const session = ADAPTER.backend.session();
    if (!session?.userId) return null;
    const user = ADAPTER.backend.users().find((item) => item.id === session.userId);
    if (!user) return null;
    return { id: user.id, name: user.name, email: user.email, role: user.role === 'curator' ? 'curator' : 'participant', demo: Boolean(user.demo) };
  };

  const redirectToLogin = (reason) => {
    const target = new URL('./login.html', window.location.href);
    if (reason) target.searchParams.set('reason', reason);
    window.location.replace(target.href);
  };

  const requireUser = () => {
    const user = currentUser();
    if (!user) {
      redirectToLogin('auth');
      return null;
    }
    return user;
  };

  const requireCurator = () => {
    const user = requireUser();
    if (!user) return null;
    if (user.role !== 'curator') return { user, denied: true };
    return { user, denied: false };
  };

  const loginUrl = () => new URL('/account/login.html', window.location.origin).href;

  const requestCuratorRole = async (userId) => {
    if (!supa || !userId) return false;
    try {
      await supa.from('role_requests').insert({ user_id: userId });
      return true;
    } catch { return false; }
  };

  const grantCurator = async (userId) => {
    if (!supa || !userId) throw new Error('server');
    const { data, error } = await supa.from('profiles').update({ role: 'curator' }).eq('id', userId).select('id,role').single();
    if (error) throw new Error('server');
    return data;
  };
  const pendingRoleRequests = async () => {
    if (!supa) return [];
    const { data, error } = await supa.from('role_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false });
    if (error) return [];
    const ids = (data || []).map((row) => row.user_id);
    let names = new Map();
    if (ids.length) {
      const { data: profiles } = await supa.from('profiles').select('id,name').in('id', ids);
      names = new Map((profiles || []).map((row) => [row.id, row.name]));
    }
    return (data || []).map((row) => ({ id: row.id, userId: row.user_id, name: names.get(row.user_id) || row.user_id, createdAt: row.created_at }));
  };

  const answerRoleRequest = async (requestId, approve, adminName) => {
    if (!supa) throw new Error('server');
    const { data, error } = await supa.from('role_requests').update({
      status: approve ? 'approved' : 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: adminName || '',
    }).eq('id', requestId).select('user_id').single();
    if (error) throw new Error('server');
    if (approve && data?.user_id) {
      const { error: roleError } = await supa.from('profiles').update({ role: 'curator' }).eq('id', data.user_id);
      if (roleError) throw new Error('server');
    }
    return true;
  };
  const register = async ({ name, email, password, role }) => {
    if (useRaw()) {
      const displayName = String(name || '').trim() || normalizeEmail(email).split('@')[0];
      try {
        const data = await rawAuth.call('/signup?redirect_to=' + encodeURIComponent(loginUrl()), { body: { email: normalizeEmail(email), password, data: { name: displayName, role: 'participant' } } });
        if (!data?.session) return null;
        rawAuth.write(data);
        return rawAuth.user();
      } catch (error) {
        const text = JSON.stringify(error.data || '');
        if (/already|registered|exists/i.test(text)) throw new Error('taken');
        if (/weak|short|password/i.test(text)) throw new Error('weak');
        if (error.status === 429) throw new Error('rate');
        throw new Error('server');
      }
    }
    if (supa) {
      const displayName = String(name || '').trim() || normalizeEmail(email).split('@')[0];
      const { data, error } = await supa.auth.signUp({
        email: normalizeEmail(email),
        password,
        options: { emailRedirectTo: loginUrl(), data: { name: displayName, role: 'participant' } },
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) throw new Error('taken');
        if (/weak|short|password/i.test(error.message)) throw new Error('weak');
        if (error.status === 429 || /rate|too many/i.test(error.message)) throw new Error('rate');
        throw new Error('server');
      }
      if (!data.session) return null;
      await syncServerSession();
      return currentUser();
    }
    if (!window.crypto?.subtle) throw new Error('crypto');
    const users = ADAPTER.backend.users();
    if (users.some((user) => user.email === normalizeEmail(email))) throw new Error('taken');
    const salt = randomSalt();
    const hash = await sha256(`${salt}:${password}`);
    const user = {
      id: uid(),
      name: String(name || '').trim() || normalizeEmail(email).split('@')[0],
      email: normalizeEmail(email),
      role: role === 'curator' ? 'curator' : 'participant',
      salt,
      hash,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    if (!ADAPTER.backend.saveUsers(users)) throw new Error('storage');
    if (!ADAPTER.backend.saveSession({ userId: user.id, at: Date.now() })) throw new Error('storage');
    return currentUser();
  };

  const login = async ({ email, password }) => {
    if (useRaw()) {
      try {
        const data = await rawAuth.call('/token?grant_type=password', { body: { email: normalizeEmail(email), password } });
        rawAuth.write(data);
        return rawAuth.user();
      } catch (error) {
        const text = JSON.stringify(error.data || '');
        if (/not confirmed/i.test(text)) throw new Error('confirm');
        if (error.status === 400 || error.status === 401) throw new Error('credentials');
        throw new Error('server');
      }
    }
    if (supa) {
      const { error } = await supa.auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (error) {
        if (/confirm/i.test(error.message)) throw new Error('confirm');
        if (/invalid|credentials/i.test(error.message)) throw new Error('credentials');
        if (error.status === 429 || /rate|too many/i.test(error.message)) throw new Error('rate');
        throw new Error('server');
      }
      await syncServerSession();
      return currentUser();
    }
    if (!window.crypto?.subtle) throw new Error('crypto');
    const user = findUser(email);
    if (!user) throw new Error('credentials');
    if (user.demo && !user.hash) {
      if (password !== 'okto-demo') throw new Error('credentials');
    } else {
      const hash = await sha256(`${user.salt}:${password}`);
      if (hash !== user.hash) throw new Error('credentials');
    }
    if (!ADAPTER.backend.saveSession({ userId: user.id, at: Date.now() })) throw new Error('storage');
    return currentUser();
  };

  const logout = async () => {
    if (useRaw()) rawAuth.write(null);
    if (supa) {
      try { await supa.auth.signOut(); } catch { /* ignore */ }
    }
    try { window.localStorage.removeItem(`${PREFIX}session`); } catch { /* storage unavailable */ }
    window.location.href = './login.html';
  };

  /* ---------- данные: курсы, задания, журнал ---------- */

  const listCourses = async () => {
    if (supa) return serverCourses();
    return ADAPTER.backend.courses().slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  };

  const publishedCourses = async () => (await listCourses()).filter((course) => course.published);

  const addCourse = async (payload) => {
    const makeId = (slug) => (slug || 'course') + '-' + Date.now().toString(36);
    if (supa) {
      const { data, error } = await supa.from('courses').insert({
        id: makeId(payload.slug),
        title: payload.title,
        level: payload.level,
        description: payload.description,
        lessons: payload.lessons,
        url: payload.url || '',
        published: false,
        author: serverSession()?.id || null,
      }).select('*').single();
      if (error) throw new Error('server');
      return toCourse(data);
    }
    const courses = ADAPTER.backend.courses();
    const course = {
      id: `${payload.slug || 'course'}-${Date.now().toString(36)}`,
      title: payload.title,
      level: payload.level,
      description: payload.description,
      lessons: payload.lessons,
      url: payload.url,
      published: false,
      createdAt: new Date().toISOString(),
    };
    courses.push(course);
    ADAPTER.backend.saveCourses(courses);
    return course;
  };

  const toggleCoursePublished = async (courseId, published) => {
    if (supa) {
      const { data, error } = await supa.from('courses').update({ published: Boolean(published) }).eq('id', courseId).select('*').single();
      if (error) throw new Error('server');
      return toCourse(data);
    }
    const courses = ADAPTER.backend.courses().map((course) => (course.id === courseId ? { ...course, published } : course));
    ADAPTER.backend.saveCourses(courses);
    return courses.find((course) => course.id === courseId) || null;
  };

  const removeCourse = async (courseId) => {
    if (supa) {
      const { error } = await supa.from('courses').delete().eq('id', courseId);
      if (error) throw new Error('server');
      return;
    }
    ADAPTER.backend.saveCourses(ADAPTER.backend.courses().filter((course) => course.id !== courseId));
  };

  /* ---------- проекты ---------- */

  let projectsSupported = null;
  const projectsMissing = (error) => Boolean(error && (/42P01|PGRST205|does not exist|schema cache/i.test(String(error.code || '') + String(error.message || ''))));

  const toProject = (row) => ({
    id: row.id,
    title: row.title || '',
    tag: row.tag || '',
    description: row.description || '',
    link: row.link || '',
    published: Boolean(row.published),
    createdAt: row.created_at,
  });

  const projectsState = () => {
    if (projectsSupported === null) projectsSupported = true;
    return projectsSupported;
  };

  const listProjects = async () => {
    if (!supa) return [];
    if (!projectsState()) return [];
    const { data, error } = await supa.from('projects').select('*').order('created_at', { ascending: false });
    if (error) {
      if (projectsMissing(error)) { projectsSupported = false; return []; }
      throw new Error('server');
    }
    return (data || []).map(toProject);
  };

  const addProject = async (payload) => {
    if (!supa) throw new Error('server');
    const { data, error } = await supa.from('projects').insert({
      title: payload.title,
      tag: payload.tag || '',
      description: payload.description,
      link: payload.link || '',
      published: Boolean(payload.published),
      author: serverSession()?.id || null,
    }).select('*').single();
    if (error) {
      if (projectsMissing(error)) { projectsSupported = false; throw new Error('missing'); }
      throw new Error('server');
    }
    projectsSupported = true;
    return toProject(data);
  };

  const toggleProjectPublished = async (projectId, published) => {
    if (!supa) throw new Error('server');
    const { data, error } = await supa.from('projects').update({ published: Boolean(published) }).eq('id', projectId).select('*').single();
    if (error) throw new Error('server');
    return toProject(data);
  };

  const removeProject = async (projectId) => {
    if (!supa) throw new Error('server');
    const { error } = await supa.from('projects').delete().eq('id', projectId);
    if (error) throw new Error('server');
  };

  const publishedProjects = async () => (await listProjects()).filter((project) => project.published);
  const slugify = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/(^-|-$)/g, '') || 'course';

  const lessonsOf = (course) => {
    const total = Math.max(1, Math.min(60, Number(course?.lessons) || 1));
    return Array.from({ length: total }, (_, index) => ({
      index: index + 1,
      label: `Занятие ${index + 1}`,
    }));
  };

  const addSubmission = async ({ userId, userName, courseId, lessonIndex, text, url }) => {
    const courses = await listCourses();
    const course = courses.find((item) => item.id === courseId);
    if (!course) throw new Error('course');
    if (supa) {
      const { data, error } = await supa.from('submissions').insert({
        user_id: userId,
        course_id: courseId,
        lesson: 'Занятие ' + (Number(lessonIndex) || 1),
        text_body: String(text || '').trim(),
        link: normalizeUrl(url),
        status: 'pending',
      }).select('*').single();
      if (error) throw new Error('server');
      return toSubmission(data);
    }
    const items = ADAPTER.backend.submissions();
    const item = {
      id: uid(),
      userId,
      userName,
      courseId,
      courseTitle: course.title,
      lessonIndex: Number(lessonIndex) || 1,
      text: String(text || '').trim(),
      url: normalizeUrl(url),
      status: 'review',
      createdAt: new Date().toISOString(),
      checkedAt: null,
      checkedBy: null,
    };
    items.push(item);
    if (!ADAPTER.backend.saveSubmissions(items)) throw new Error('storage');
    return item;
  };

  const setSubmissionStatus = async (submissionId, status, curatorName) => {
    if (!STATUS[status] || !['accepted', 'rework'].includes(status)) return null;
    if (supa) {
      const { data, error } = await supa.from('submissions').update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: serverSession()?.id || null,
      }).eq('id', submissionId).select('*').single();
      if (error) throw new Error('server');
      return toSubmission(data);
    }
    const items = ADAPTER.backend.submissions().map((item) => (item.id === submissionId
      ? { ...item, status, checkedAt: new Date().toISOString(), checkedBy: curatorName || 'куратор' }
      : item));
    ADAPTER.backend.saveSubmissions(items);
    return items.find((item) => item.id === submissionId) || null;
  };

  const submissionsForUser = async (userId) => {
    const all = supa ? await serverSubmissions() : ADAPTER.backend.submissions();
    return all
      .filter((item) => item.userId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  };

  const participantUsers = async () => {
    if (supa) {
      const { data, error } = await supa.from('profiles').select('id,name,role');
      if (error) throw new Error('server');
      return (data || [])
        .filter((row) => row.role !== 'curator')
        .map((row) => ({ id: row.id, name: row.name, email: '', role: row.role }));
    }
    return ADAPTER.backend.users().filter((user) => user.role !== 'curator' && !user.demo);
  };

  const curatorUsers = async () => {
    if (supa) {
      const { data, error } = await supa.from('profiles').select('id,name,role').eq('role', 'curator');
      if (error) throw new Error('server');
      return (data || []).map((row) => ({ id: row.id, name: row.name, email: '', role: 'curator' }));
    }
    return ADAPTER.backend.users().filter((user) => user.role === 'curator' && !user.demo);
  };

  const revokeCurator = async (userId) => {
    if (!supa || !userId) throw new Error('server');
    const { data, error } = await supa.from('profiles').update({ role: 'participant' }).eq('id', userId).select('id,role').single();
    if (error) throw new Error('server');
    return data;
  };
  const serverProgress = async () => {
    const { data, error } = await supa.from('progress').select('user_id,course_id,lesson_id,done');
    if (error) throw new Error('server');
    const map = {};
    (data || []).forEach((row) => {
      map[row.user_id] = map[row.user_id] || {};
      map[row.user_id][row.course_id] = map[row.user_id][row.course_id] || [];
      if (row.done) map[row.user_id][row.course_id].push(row.lesson_id);
    });
    return map;
  };

  const progressFor = async (userId, course, map) => {
    if (!course) return 0;
    const source = supa ? (map || await serverProgress()) : ADAPTER.backend.progress();
    const stored = source[userId]?.[course.id];
    if (Array.isArray(stored)) return Math.min(Number(course.lessons) || 0, stored.length);
    if (Number.isInteger(stored)) return Math.max(0, Math.min(Number(course.lessons) || 0, stored));
    return Math.min(Number(course.lessons) || 0, courseProgressLink(course));
  };

  const journalRows = async (courseId) => {
    const courses = await listCourses();
    const filtered = courseId && courseId !== 'all' ? courses.filter((course) => course.id === courseId) : courses;
    const users = await participantUsers();
    const map = supa ? await serverProgress() : null;
    const seen = new Set(users.map((user) => user.id));
    const session = currentUser();
    if (session && session.role === 'participant' && !seen.has(session.id)) users.push(session);
    const rows = [];
    for (const user of users) {
      const cells = [];
      for (const course of filtered) {
        const done = await progressFor(user.id, course, map);
        const total = Number(course.lessons) || 0;
        cells.push({ courseId: course.id, courseTitle: course.title, done, total, percent: percentOf(done, total) });
      }
      const doneSum = cells.reduce((sum, cell) => sum + cell.done, 0);
      const totalSum = cells.reduce((sum, cell) => sum + cell.total, 0);
      rows.push({ user, cells, done: doneSum, total: totalSum, percent: percentOf(doneSum, totalSum) });
    }
    return rows;
  };

  /* Плашка демо-режима и подсказки демо-входа видны только без сервера. */
  const syncDemoChrome = () => {
    const demo = ADAPTER.isDemo;
    document.querySelectorAll('#demo-note, .demo-credentials').forEach((node) => {
      node.hidden = !demo;
      if (demo && node.id === 'demo-note') node.textContent = TEXT.demoNote;
    });
    document.querySelectorAll('#login-password-hint').forEach((node) => {
      if (!demo) node.textContent = 'От 6 символов.';
    });
  };

  /* ---------- страница входа ---------- */

  const initLoginPage = () => {
    const form = document.querySelector('#auth-form');
    if (!form) return;
    syncDemoChrome();

    const existing = currentUser();
    if (existing) {
      window.location.replace(existing.role === 'curator' ? './curator.html' : './dashboard.html');
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('reason') === 'auth') notify('Сначала войдите: кабинет открывается только после входа.', 'warn');
    if (params.get('reason') === 'curator') notify('Раздел куратора доступен только с ролью «Куратор».', 'warn');
    if (!storageAvailable) notify(TEXT.storageBlocked, 'error');

    const roleInputs = [...form.querySelectorAll('input[name="role"]')];
    const curatorNote = document.querySelector('#curator-note');
    let curatorRequested = false;
    const modeButtons = [...document.querySelectorAll('[data-auth-mode]')];
    const submit = form.querySelector('button[type="submit"]');
    const forgot = document.querySelector('#forgot-password');
    let mode = 'login';

    const syncRoleNote = () => {
      const role = roleInputs.find((input) => input.checked)?.value || 'participant';
      if (curatorNote) {
        curatorNote.hidden = role !== 'curator';
      }
      const note = document.querySelector('#role-note');
      if (note) {
        note.textContent = role === 'curator'
          ? 'Куратор загружает курсы, проверяет задания и меняет их статусы.'
          : 'Участник проходит курсы, отмечает занятия и отправляет работы на проверку.';
      }
    };

    const setMode = (next) => {
      mode = next === 'register' ? 'register' : 'login';
      modeButtons.forEach((button) => {
        const active = button.dataset.authMode === mode;
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('is-active', active);
      });
      document.querySelectorAll('[data-mode-only]').forEach((node) => {
        node.hidden = node.dataset.modeOnly !== mode;
      });
      if (submit) submit.textContent = mode === 'register' ? 'Зарегистрироваться' : 'Войти';
      if (forgot) forgot.hidden = mode !== 'login';
      clearErrors(form);
      notify('');
      const first = document.querySelector(mode === 'register' ? '#reg-name' : '#login-email');
      first?.focus({ preventScroll: true });
    };

    modeButtons.forEach((button) => button.addEventListener('click', () => {
      try { setMode(button.dataset.authMode); } catch (error) { console.error('[ОКТО вход]', error); }
    }));
    roleInputs.forEach((input) => input.addEventListener('change', syncRoleNote));
    syncRoleNote();
    setMode('login');
    if (params.get('mode') === 'register') setMode('register');

    forgot?.addEventListener('click', async (event) => {
      event.preventDefault();
      if (!serverMode()) { notify(TEXT.forgotHint, 'warn'); return; }
      const email = normalizeEmail(form.querySelector('#login-email')?.value);
      if (!validEmail(email)) {
        fieldError('login-email', TEXT.forgotEmail);
        form.querySelector('#login-email')?.focus();
        return;
      }
      try {
        if (supa) {
          const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: loginUrl() });
          if (error) throw error;
        } else {
          await rawAuth.call('/recover?redirect_to=' + encodeURIComponent(loginUrl()), { body: { email } });
        }
        notify(TEXT.forgotSent, 'ok');
      } catch {
        notify(TEXT.serverError, 'error');
      }
    });

    const validateLogin = () => {
      const email = form.querySelector('#login-email');
      const password = form.querySelector('#login-password');
      let ok = true;
      if (!validEmail(email.value)) { fieldError('login-email', 'Введите email вида имя@домен.рф'); ok = false; }
      if (password.value.length < 6) { fieldError('login-password', 'Пароль короче 6 символов. Проверьте раскладку.'); ok = false; }
      if (!ok) form.querySelector('[aria-invalid="true"]')?.focus();
      return ok;
    };

    const validateRegister = () => {
      const name = form.querySelector('#reg-name');
      const email = form.querySelector('#reg-email');
      const password = form.querySelector('#reg-password');
      const repeat = form.querySelector('#reg-password-2');
      let ok = true;
      if (name.value.trim().length < 2) { fieldError('reg-name', 'Как к вам обращаться? Минимум 2 символа.'); ok = false; }
      if (!validEmail(email.value)) { fieldError('reg-email', 'Введите email вида имя@домен.рф'); ok = false; }
      if (password.value.length < 8) { fieldError('reg-password', 'Нужно минимум 8 символов.'); ok = false; }
      if (password.value && password.value !== repeat.value) { fieldError('reg-password-2', 'Пароли не совпадают.'); ok = false; }
      if (!ok) form.querySelector('[aria-invalid="true"]')?.focus();
      return ok;
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      if (mode === 'login' ? !validateLogin() : !validateRegister()) return;
      busy(form, true, mode === 'login' ? 'Входим…' : 'Создаём аккаунт…');
      try {
        const user = mode === 'login'
          ? await login({ email: form.querySelector('#login-email').value, password: form.querySelector('#login-password').value })
          : await register({
            name: form.querySelector('#reg-name').value,
            email: form.querySelector('#reg-email').value,
            password: form.querySelector('#reg-password').value,
            role: 'participant',
          });
        if (!user) {
          busy(form, false);
          setMode('login');
          const loginEmail = form.querySelector('#login-email');
          if (loginEmail) loginEmail.value = normalizeEmail(form.querySelector('#reg-email').value);
          notify(TEXT.checkEmail, 'ok');
          return;
        }
        notify(mode === 'login' ? 'Вход выполнен. Открываем кабинет…' : 'Аккаунт создан. Открываем кабинет…', 'ok');
        window.setTimeout(() => {
          window.location.href = user.role === 'curator' ? './curator.html' : './dashboard.html';
        }, 450);
      } catch (error) {
        busy(form, false);
        if (error.message === 'taken') {
          fieldError(mode === 'login' ? 'login-email' : 'reg-email', TEXT.emailTaken);
          form.querySelector(mode === 'login' ? '#login-email' : '#reg-email')?.focus();
        } else if (error.message === 'credentials') {
          fieldError('login-password', TEXT.invalidCredentials);
          form.querySelector('#login-password')?.focus();
        } else if (error.message === 'curatorPending') {
          notify('Заявка на роль куратора отправлена руководителю. Войдите как участник — доступ откроется после одобрения.', 'warn');
        } else if (error.message === 'crypto') {
          notify(TEXT.cryptoBlocked, 'error');
        } else if (error.message === 'confirm') {
          notify(TEXT.confirmEmail, 'warn');
        } else if (error.message === 'weak') {
          fieldError('reg-password', TEXT.weakPassword);
          form.querySelector('#reg-password')?.focus();
        } else if (error.message === 'rate') {
          notify(TEXT.rateLimited, 'warn');
        } else if (error.message === 'storage') {
          notify(TEXT.storageBlocked, 'error');
        } else {
          console.error('[ОКТО вход]', error);
          notify(serverMode() ? TEXT.serverError : TEXT.storageBlocked, 'error');
        }
      }
    });
  };

  /* ---------- общая шапка кабинета ---------- */

  const bindAccountChrome = (user) => {
    document.querySelectorAll('[data-account-name]').forEach((node) => { node.textContent = user.name; });
    document.querySelectorAll('[data-account-role]').forEach((node) => { node.textContent = user.role === 'curator' ? 'куратор' : 'участник'; });
    document.querySelectorAll('a[data-account-only]').forEach((link) => {
      link.hidden = user.role !== link.dataset.accountOnly;
    });
    document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    }));
    syncDemoChrome();
    const banner = document.querySelector('#session-note');
    if (banner) {
      banner.textContent = ADAPTER.isDemo ? TEXT.sessionNote : '';
      banner.hidden = !ADAPTER.isDemo;
    }
  };

  /* ---------- кабинет участника ---------- */

  const initDashboard = async (user) => {
    bindAccountChrome(user);
    document.querySelectorAll('[data-account-name]').forEach((node) => {
      if (node.closest('[data-greeting]')) node.textContent = user.name.split(' ')[0] || user.name;
    });

    const courseList = document.querySelector('#course-progress');
    const lessonSelect = document.querySelector('#task-lesson');
    const courseSelect = document.querySelector('#task-course');
    const tasksBody = document.querySelector('#task-rows');
    const tasksEmpty = document.querySelector('#task-empty');
    const stats = document.querySelector('#dashboard-stats');
    const form = document.querySelector('#task-form');

    const render = async () => {
      const courses = await publishedCourses();
      if (courseList) {
        const cards = [];
        for (const course of courses) {
          const done = await progressFor(user.id, course);
          const total = Number(course.lessons) || 0;
          const percent = percentOf(done, total);
          cards.push(`<article class="panel course-progress-card" data-course="${escapeHtml(course.id)}">
              <p class="panel-kicker">${escapeHtml(course.level)}</p>
              <h3>${escapeHtml(course.title)}</h3>
              <p class="progress-caption">${done} из ${total} ${plural(total, 'занятия', 'занятий', 'занятий')} отмечено · ${percent}%</p>
              <div class="progress-bar" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Прогресс курса ${escapeHtml(course.title)}"><span style="width:${percent}%"></span></div>
              <div class="panel-actions">
                <a class="button button-primary button-small" href="${escapeHtml(course.url || '../../index.html#courses')}">Продолжить курс <span aria-hidden="true">→</span></a>
                <span class="muted">${percent}%</span>
              </div>
            </article>`);
        }
        courseList.innerHTML = cards.length ? cards.join('') : '<p class="empty-state">Курсы ещё не опубликованы. Загляните позже.</p>';
      }

      if (courseSelect) {
        const value = courseSelect.value;
        courseSelect.innerHTML = courses.map((course) => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.title)}</option>`).join('');
        if (courses.some((course) => course.id === value)) courseSelect.value = value;
      }

      const chosen = courses.find((course) => course.id === (courseSelect?.value || courses[0]?.id));
      if (lessonSelect) {
        const lessons = chosen ? lessonsOf(chosen) : [];
        const previous = lessonSelect.value;
        lessonSelect.innerHTML = lessons.map((lesson) => `<option value="${lesson.index}">${escapeHtml(lesson.label)}</option>`).join('');
        if (lessons.some((lesson) => String(lesson.index) === previous)) lessonSelect.value = previous;
        lessonSelect.disabled = !lessons.length;
      }

      const items = await submissionsForUser(user.id);
      if (tasksBody) {
        tasksBody.innerHTML = items.map((item) => {
          const status = STATUS[item.status] || STATUS.review;
          return `<tr>
            <td data-label="Курс">${escapeHtml(item.courseTitle)}</td>
            <td data-label="Занятие">${escapeHtml(String(item.lessonIndex))}</td>
            <td data-label="Работа">${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">ссылка</a>` : '<span class="muted">без ссылки</span>'}</td>
            <td data-label="Отправлено">${escapeHtml(formatDate(item.createdAt))}</td>
            <td data-label="Статус"><span class="status ${status.className}">${status.label}</span></td>
          </tr>`;
        }).join('');
      }
      if (tasksEmpty) tasksEmpty.hidden = items.length !== 0;

      if (stats) {
        const counts = items.reduce((acc, item) => {
          acc[item.status] = (acc[item.status] || 0) + 1;
          return acc;
        }, {});
        stats.innerHTML = `
          <li><strong>${courses.length}</strong><span>${plural(courses.length, 'курс открыт', 'курса открыто', 'курсов открыто')}</span></li>
          <li><strong>${counts.review || 0}</strong><span>${plural(counts.review || 0, 'задание на проверке', 'задания на проверке', 'заданий на проверке')}</span></li>
          <li><strong>${counts.accepted || 0}</strong><span>${plural(counts.accepted || 0, 'принято', 'принято', 'принято')}</span></li>
          <li><strong>${counts.rework || 0}</strong><span>${plural(counts.rework || 0, 'требует доработки', 'требуют доработки', 'требуют доработки')}</span></li>`;
      }
    };

    courseSelect?.addEventListener('change', () => { render(); });
    try {
      await render();
    } catch {
      notify('Не удалось загрузить данные кабинета. Обновите страницу.', 'error');
    }

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const courseId = courseSelect?.value;
      const lessonIndex = Number(lessonSelect?.value || 0);
      const text = form.querySelector('#task-text').value.trim();
      const url = form.querySelector('#task-link').value.trim();
      let ok = true;
      if (!courseId) { notify('Выберите курс — сейчас опубликованных курсов нет.', 'error'); ok = false; }
      if (!lessonIndex) { fieldError('task-lesson', 'Выберите занятие.'); ok = false; }
      if (text.length < 15) { fieldError('task-text', 'Опишите работу: минимум 15 символов, чтобы куратору было что читать.'); ok = false; }
      if (url && !validUrl(url)) { fieldError('task-link', 'Ссылка должна начинаться с https:// — например, на документ или видео.'); ok = false; }
      if (!ok) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      busy(form, true, 'Отправляем…');
      try {
        await addSubmission({ userId: user.id, userName: user.name, courseId, lessonIndex, text, url });
        form.reset();
        delete form.querySelector('button[type="submit"]').dataset.label;
        busy(form, false);
        notify('Задание отправлено на проверку. Статус появится в таблице ниже.', 'ok');
        render();
      } catch (error) {
        busy(form, false);
        notify(error.message === 'storage' ? TEXT.storageBlocked : 'Не удалось сохранить задание. Попробуйте ещё раз.', 'error');
      }
    });
  };

  /* ---------- журнал прогресса ---------- */

  const initJournal = async (result) => {
    const { user, denied } = result;
    if (denied) {
      document.querySelector('#denied')?.removeAttribute('hidden');
      document.querySelector('#journal-body')?.closest('main')?.setAttribute('hidden', '');
      return;
    }
    bindAccountChrome(user);
    const table = document.querySelector('#journal-table');
    const head = document.querySelector('#journal-head');
    const body = document.querySelector('#journal-body');
    const courseFilter = document.querySelector('#journal-course');
    const sortButton = document.querySelector('#journal-sort');
    const summary = document.querySelector('#journal-summary');
    const empty = document.querySelector('#journal-empty');
    if (!table || !head || !body) return;

    let sortDir = 'desc';

    const fillFilter = async () => {
      if (!courseFilter) return;
      const courses = await listCourses();
      courseFilter.innerHTML = `<option value="all">Все курсы</option>${courses.map((course) => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.title)}</option>`).join('')}`;
    };

    const render = async () => {
      const courseId = courseFilter?.value || 'all';
      const courses = (await listCourses()).filter((course) => courseId === 'all' || course.id === courseId);
      const rows = (await journalRows(courseId)).sort((a, b) => (sortDir === 'desc' ? b.percent - a.percent : a.percent - b.percent));

      head.innerHTML = `<tr>
        <th scope="col" class="col-name">Участник</th>
        ${courses.map((course) => `<th scope="col" class="col-course" title="${escapeHtml(course.title)}">${escapeHtml(course.title)}</th>`).join('')}
        <th scope="col" class="col-total">Итого</th>
      </tr>`;

      body.innerHTML = rows.map((row) => {
        const isMe = row.user.id === user.id;
        return `<tr${isMe ? ' class="is-me"' : ''}>
          <th scope="row" class="col-name"><span class="member-name">${escapeHtml(row.user.name)}</span>${isMe ? ' <span class="tag">это вы</span>' : ''}</th>
          ${row.cells.map((cell) => `<td class="col-course" data-label="${escapeHtml(cell.courseTitle)}">
            ${cell.total ? `<span class="mark ${cell.percent === 100 ? 'is-done' : ''}">${cell.done} / ${cell.total}</span>` : '<span class="muted">—</span>'}
            <span class="cell-bar" aria-hidden="true"><span style="width:${cell.percent}%"></span></span>
          </td>`).join('')}
          <td class="col-total" data-label="Итого"><strong>${row.percent}%</strong><span class="cell-meta">${row.done} из ${row.total}</span></td>
        </tr>`;
      }).join('');

      if (empty) empty.hidden = rows.length !== 0;
      if (summary) {
        const average = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.percent, 0) / rows.length) : 0;
        summary.textContent = `Участников: ${rows.length}. Средний прогресс: ${average}%. Отметки ставятся в самом курсе — прогресс обновляется автоматически.`;
      }
      if (sortButton) {
        sortButton.textContent = sortDir === 'desc' ? 'Процент: по убыванию ↓' : 'Процент: по возрастанию ↑';
        sortButton.setAttribute('aria-pressed', String(sortDir === 'asc'));
      }
    };

    try {
      await fillFilter();
      await render();
    } catch {
      if (empty) empty.hidden = false;
      if (summary) summary.textContent = 'Не удалось загрузить журнал. Обновите страницу.';
    }
    courseFilter?.addEventListener('change', () => { render(); });
    sortButton?.addEventListener('click', () => {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      render();
    });
  };

  /* ---------- кабинет куратора ---------- */

  const initCurator = async (result) => {
    const { user, denied } = result;
    if (denied) {
      document.querySelector('#denied')?.removeAttribute('hidden');
      document.querySelector('#curator-main')?.setAttribute('hidden', '');
      return;
    }
    bindAccountChrome(user);
    const form = document.querySelector('#course-form');
    const coursesBody = document.querySelector('#curator-courses');
    const coursesEmpty = document.querySelector('#courses-empty');
    const tasksBody = document.querySelector('#curator-tasks');
    const tasksEmpty = document.querySelector('#tasks-empty');
    const tasksStatus = document.querySelector('#tasks-status');
    const taskFilter = document.querySelector('#task-status-filter');

    const renderCourses = async () => {
      const courses = await listCourses();
      if (coursesBody) {
        coursesBody.innerHTML = courses.map((course) => `<tr data-course-row="${escapeHtml(course.id)}">
          <th scope="row" data-label="Курс">
            <span class="course-cell-title">${escapeHtml(course.title)}</span>
            <span class="cell-meta">${escapeHtml(course.level)} · ${course.lessons} ${plural(course.lessons, 'занятие', 'занятия', 'занятий')}</span>
            ${course.url ? `<a class="cell-link" href="${escapeHtml(course.url)}" target="_blank" rel="noopener noreferrer">материал ↗</a>` : '<span class="cell-meta">материал не указан</span>'}
          </th>
          <td data-label="Статус"><span class="status ${course.published ? 'is-accepted' : 'is-review'}">${course.published ? 'опубликован' : 'черновик'}</span></td>
          <td data-label="Действия"><div class="row-actions">
            <button type="button" class="button button-quiet button-small" data-course-toggle="${escapeHtml(course.id)}">${course.published ? 'Снять с публикации' : 'Опубликовать'}</button>
            <button type="button" class="button button-bare button-small" data-course-remove="${escapeHtml(course.id)}">Удалить</button>
          </div></td>
        </tr>`).join('');
      }
      if (coursesEmpty) coursesEmpty.hidden = courses.length !== 0;
      const count = document.querySelector('#course-count');
      if (count) count.textContent = String(courses.length);
    };

    const renderTasks = () => {
      if (!tasksBody) return;
      const filter = taskFilter?.value || 'review';
      const all = ADAPTER.backend.submissions().slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const items = all.filter((item) => filter === 'all' || item.status === filter);
      tasksBody.innerHTML = items.map((item) => `<tr data-task-row="${escapeHtml(item.id)}">
        <th scope="row" data-label="Участник"><span class="member-name">${escapeHtml(item.userName)}</span><span class="cell-meta">${escapeHtml(formatDate(item.createdAt))}</span></th>
        <td data-label="Курс"><span class="course-cell-title">${escapeHtml(item.courseTitle)}</span><span class="cell-meta">Занятие ${escapeHtml(String(item.lessonIndex))}</span></td>
        <td data-label="Работа"><p class="task-text">${escapeHtml(item.text)}</p>${item.url ? `<a class="cell-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">открыть работу ↗</a>` : ''}</td>
        <td data-label="Статус"><span class="status ${(STATUS[item.status] || STATUS.review).className}">${(STATUS[item.status] || STATUS.review).label}</span></td>
        <td data-label="Решение"><div class="row-actions">
          <button type="button" class="button button-small" data-task-action="accepted" data-task-id="${escapeHtml(item.id)}"${item.status === 'accepted' ? ' disabled' : ''}>Принять</button>
          <button type="button" class="button button-bare button-small" data-task-action="rework" data-task-id="${escapeHtml(item.id)}"${item.status === 'rework' ? ' disabled' : ''}>На доработку</button>
        </div></td>
      </tr>`).join('');
      if (tasksEmpty) tasksEmpty.hidden = items.length !== 0;
      if (tasksStatus) {
        const pending = all.filter((item) => item.status === 'review').length;
        tasksStatus.textContent = `Всего работ: ${all.length}. Ждут проверки: ${pending}.`;
      }
    };

    try {
      await renderCourses();
    } catch {
      notify('Не удалось загрузить курсы.', 'error');
    }
    renderTasks();

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const title = form.querySelector('#course-title');
      const level = form.querySelector('#course-level');
      const description = form.querySelector('#course-description');
      const lessons = form.querySelector('#course-lessons');
      const url = form.querySelector('#course-url');
      let ok = true;
      if (title.value.trim().length < 3) { fieldError('course-title', 'Название минимум 3 символа.'); ok = false; }
      if (!level.value) { fieldError('course-level', 'Выберите уровень.'); ok = false; }
      if (description.value.trim().length < 20) { fieldError('course-description', 'Опишите курс подробнее: минимум 20 символов.'); ok = false; }
      const lessonCount = Number(lessons.value);
      if (!Number.isInteger(lessonCount) || lessonCount < 1 || lessonCount > 60) { fieldError('course-lessons', 'Число занятий — целое от 1 до 60.'); ok = false; }
      if (url.value.trim() && !validUrl(url.value)) { fieldError('course-url', 'Ссылка должна вести на https://-адрес.'); ok = false; }
      if (!ok) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }

      busy(form, true, 'Сохраняем…');
      try {
        await addCourse({
          title: title.value.trim(),
          level: level.value,
          description: description.value.trim(),
          lessons: lessonCount,
          url: normalizeUrl(url.value),
          slug: slugify(title.value),
        });
        form.reset();
        delete form.querySelector('button[type="submit"]').dataset.label;
        busy(form, false);
        notify('Курс сохранён как черновик. Нажмите «Опубликовать», чтобы участники его увидели.', 'ok');
        renderCourses();
      } catch {
        busy(form, false);
        notify(TEXT.storageBlocked, 'error');
      }
    });

    coursesBody?.addEventListener('click', async (event) => {
      const toggle = event.target.closest('[data-course-toggle]');
      const remove = event.target.closest('[data-course-remove]');
      if (toggle) {
        const course = (await listCourses()).find((item) => item.id === toggle.dataset.courseToggle);
        if (!course) return;
        try {
          await toggleCoursePublished(course.id, !course.published);
        } catch {
          notify('Не удалось изменить публикацию курса. Попробуйте ещё раз.', 'error');
          return;
        }
        notify(course.published ? 'Курс снят с публикации.' : 'Курс опубликован — участники видят его в кабинете.', 'ok');
        await renderCourses();
        return;
      }
      if (remove) {
        const course = (await listCourses()).find((item) => item.id === remove.dataset.courseRemove);
        if (!course) return;
        const confirmed = window.confirm(`Удалить курс «${course.title}»? Отметки и задания останутся, но курс исчезнет из кабинета участников.`);
        if (!confirmed) return;
        try {
          await removeCourse(course.id);
        } catch {
          notify('Не удалось удалить курс. Попробуйте ещё раз.', 'error');
          return;
        }
        notify('Курс удалён.', 'ok');
        await renderCourses();
      }
    });

    tasksBody?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-task-action]');
      if (!button) return;
      let item = null;
      try {
        item = await setSubmissionStatus(button.dataset.taskId, button.dataset.taskAction, user.name);
      } catch {
        notify('Не удалось обновить статус. Попробуйте ещё раз.', 'error');
        return;
      }
      if (!item) return;
      notify(item.status === 'accepted' ? 'Работа принята — участник увидит новый статус.' : 'Работа отправлена на доработку.', 'ok');
      renderTasks();
    });

    let savedProjectsOff = false;
    const formProject = document.querySelector('#project-form');
    const projectsBody = document.querySelector('#curator-projects');
    const projectsEmpty = document.querySelector('#projects-empty');
    const projectCount = document.querySelector('#project-count');
    const projectStatus = document.querySelector('#project-status');
    const projectHint = document.querySelector('#project-hint');

    const setProjectNote = (text, tone) => {
      if (!projectStatus) return;
      projectStatus.textContent = text || '';
      projectStatus.hidden = !text;
      projectStatus.dataset.tone = tone || 'info';
    };

    const renderProjects = async () => {
      if (!projectsBody) return;
      let projects = [];
      try {
        projects = await listProjects();
      } catch {
        notify('Не удалось загрузить проекты.', 'error');
        return;
      }
      if (projectCount) projectCount.textContent = String(projects.length);
      if (projectsEmpty) projectsEmpty.hidden = projects.length !== 0;
      if (projectsBody) {
        projectsBody.innerHTML = projects.map((project) => `<tr data-project-row="${escapeHtml(project.id)}">
          <th scope="row" data-label="Проект">
            <span class="course-cell-title">${escapeHtml(project.title)}</span>
            <span class="cell-meta">${escapeHtml(project.tag || 'без направления')}${project.link ? ` · <a class="cell-link" href="${escapeHtml(project.link)}" target="_blank" rel="noopener noreferrer">ссылка ↗</a>` : ''}</span>
          </th>
          <td data-label="Статус"><span class="status ${project.published ? 'is-accepted' : 'is-review'}">${project.published ? 'опубликован' : 'черновик'}</span></td>
          <td data-label="Действия"><div class="row-actions">
            <button type="button" class="button button-quiet button-small" data-project-toggle="${escapeHtml(project.id)}">${project.published ? 'Снять с публикации' : 'Опубликовать'}</button>
            <button type="button" class="button button-bare button-small" data-project-remove="${escapeHtml(project.id)}">Удалить</button>
          </div></td>
        </tr>`).join('');
      }
      if (projectHint && savedProjectsOff) {
        projectHint.textContent = 'Таблицы проектов в базе пока нет — выполните database/projects.sql в Supabase.';
      }
    };

    savedProjectsOff = false;
    try { await renderProjects(); } catch { /* сообщение уже показано */ }

    formProject?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(formProject);
      const title = formProject.querySelector('#project-title');
      const tag = formProject.querySelector('#project-tag');
      const description = formProject.querySelector('#project-description');
      const link = formProject.querySelector('#project-link');
      const publishedSelect = formProject.querySelector('#project-published');
      let ok = true;
      if (title.value.trim().length < 3) { fieldError('project-title', 'Название минимум 3 символа.'); ok = false; }
      if (description.value.trim().length < 20) { fieldError('project-description', 'Опишите проект подробнее: минимум 20 символов.'); ok = false; }
      if (link.value.trim() && !validUrl(link.value)) { fieldError('project-link', 'Ссылка должна вести на https://-адрес.'); ok = false; }
      if (!ok) { formProject.querySelector('[aria-invalid="true"]')?.focus(); return; }

      busy(formProject, true, 'Сохраняем…');
      try {
        await addProject({
          title: title.value.trim(),
          tag: tag.value.trim(),
          description: description.value.trim(),
          link: normalizeUrl(link.value),
          published: publishedSelect?.value === 'published',
        });
        formProject.reset();
        delete formProject.querySelector('button[type="submit"]').dataset.label;
        busy(formProject, false);
        setProjectNote('Проект сохранён.', 'ok');
        notify('Проект добавлен.', 'ok');
        savedProjectsOff = false;
        if (projectHint) projectHint.textContent = 'Проекты видны на странице проектов сайта.';
        await renderProjects();
      } catch (error) {
        busy(formProject, false);
        if (error.message === 'missing') {
          savedProjectsOff = true;
          setProjectNote('В базе пока нет таблицы projects. Выполните database/projects.sql в Supabase SQL Editor.', 'error');
        } else {
          setProjectNote('Не удалось сохранить проект. Попробуйте ещё раз.', 'error');
        }
      }
    });

    projectsBody?.addEventListener('click', async (event) => {
      const toggle = event.target.closest('[data-project-toggle]');
      const remove = event.target.closest('[data-project-remove]');
      if (toggle) {
        const project = (await listProjects()).find((item) => item.id === toggle.dataset.projectToggle);
        if (!project) return;
        try {
          await toggleProjectPublished(project.id, !project.published);
        } catch {
          setProjectNote('Не удалось изменить публикацию проекта.', 'error');
          return;
        }
        setProjectNote(project.published ? 'Проект снят с публикации.' : 'Проект опубликован.', 'ok');
        await renderProjects();
        return;
      }
      if (remove) {
        const project = (await listProjects()).find((item) => item.id === remove.dataset.projectRemove);
        if (!project) return;
        if (!window.confirm(`Удалить проект «${project.title}»?`)) return;
        try {
          await removeProject(project.id);
        } catch {
          setProjectNote('Не удалось удалить проект.', 'error');
          return;
        }
        setProjectNote('Проект удалён.', 'ok');
        await renderProjects();
      }
    });
    const peopleBody = document.querySelector('#curator-people');
    const peopleEmpty = document.querySelector('#people-empty');
    const peopleCount = document.querySelector('#people-count');
    const renderPeople = async () => {
      if (!peopleBody) return;
      let list = [];
      try {
        list = await participantUsers();
      } catch {
        notify('Не удалось загрузить участников.', 'error');
        return;
      }
      if (peopleCount) peopleCount.textContent = String(list.length);
      if (peopleEmpty) peopleEmpty.hidden = list.length !== 0;
      peopleBody.innerHTML = list.map((person) => `<tr data-person-row="${escapeHtml(person.id)}">
        <th scope="row" data-label="Участник"><span class="member-name">${escapeHtml(person.name)}</span><span class="cell-meta">${escapeHtml(person.email || '')}</span></th>
        <td data-label="Роль"><span class="status is-open">участник</span></td>
        <td data-label="Действие"><div class="row-actions">
          <button type="button" class="button button-small" data-person-promote="${escapeHtml(person.id)}">Сделать куратором</button>
        </div></td>
      </tr>`).join('');
    };

    try { await renderPeople(); } catch { /* сообщение уже показано */ }

    peopleBody?.addEventListener('click', async (event) => {
      const promote = event.target.closest('[data-person-promote]');
      if (!promote) return;
      const row = promote.closest('tr');
      const name = row?.querySelector('.member-name')?.textContent || 'участник';
      if (!window.confirm(`Выдать доступ куратора пользователю «${name}»?`)) return;
      try {
        await grantCurator(promote.dataset.personPromote);
      } catch {
        notify('Не удалось выдать роль. Проверьте правила доступа в базе.', 'error');
        return;
      }
      notify('Доступ куратора выдан.', 'ok');
      await renderPeople();
      await renderCuratorInfo();
    });

    const curatorsBody = document.querySelector('#curator-list');
    const curatorsEmpty = document.querySelector('#curators-empty');
    const curatorsCount = document.querySelector('#curators-count');
    const renderCuratorInfo = async () => {
      if (!curatorsBody) return;
      let list = [];
      try {
        list = await curatorUsers();
      } catch {
        notify('Не удалось загрузить список кураторов.', 'error');
        return;
      }
      if (curatorsCount) curatorsCount.textContent = String(list.length);
      if (curatorsEmpty) curatorsEmpty.hidden = list.length !== 0;
      const me = currentUser();
      curatorsBody.innerHTML = list.map((person) => `<tr data-curator-row="${escapeHtml(person.id)}">
        <th scope="row" data-label="Куратор"><span class="member-name">${escapeHtml(person.name)}</span><span class="cell-meta">${escapeHtml(person.email || '')}</span></th>
        <td data-label="Роль"><span class="status is-open">куратор</span></td>
        <td data-label="Действие"><div class="row-actions">
          ${person.id === me?.id
            ? '<span class="cell-meta">это вы</span>'
            : `<button type="button" class="button button-bare button-small" data-curator-demote="${escapeHtml(person.id)}">Вернуть к участникам</button>`}
        </div></td>
      </tr>`).join('');
    };

    try { await renderCuratorInfo(); } catch { /* сообщение уже показано */ }

    curatorsBody?.addEventListener('click', async (event) => {
      const demote = event.target.closest('[data-curator-demote]');
      if (!demote) return;
      const row = demote.closest('tr');
      const name = row?.querySelector('.member-name')?.textContent || 'куратор';
      if (!window.confirm(`Снять роль куратора с «${name}»?`)) return;
      try {
        await revokeCurator(demote.dataset.curatorDemote);
      } catch {
        notify('Не удалось снять роль. Проверьте правила доступа в базе.', 'error');
        return;
      }
      notify('Роль куратора снята.', 'ok');
      await renderPeople();
      await renderCuratorInfo();
    });
  };

  /* ---------- запуск ---------- */

  const start = async () => {
    syncDemoChrome();
    if (supa) {
      try { await syncServerSession(); } catch (error) { console.error('[ОКТО] сессия не получена', error); }
    }
    if (ADAPTER.isDemo) {
      try {
        ADAPTER.backend.ensureSeed();
        storageAvailable = true;
      } catch {
        storageAvailable = false;
      }
    }
    const page = document.body.dataset.page;
    if (page === 'login') { initLoginPage(); return; }
    if (page === 'dashboard') {
      const user = requireUser();
      if (user) initDashboard(user);
      return;
    }
    if (page === 'journal') {
      const result = requireCurator();
      if (result) initJournal(result);
      return;
    }
    if (page === 'curator') {
      const result = requireCurator();
      if (result) initCurator(result);
      return;
    }
  };

  window.OKTO_DEBUG = { supabaseLib: typeof window.supabase, createClient: typeof window.supabase?.createClient, cfgUrl: SUPA_CFG.supabaseUrl || 'нет', cfgKey: SUPA_CFG.supabaseAnonKey ? 'есть' : 'нет', demo: ADAPTER.isDemo }; /* vx33 */
  window.OKTO_DIAG = () => ({ demo: ADAPTER.isDemo, supa: Boolean(supa), hasSupabaseLib: Boolean(window.supabase?.createClient), config: { url: SUPA_CFG.supabaseUrl || '', key: SUPA_CFG.supabaseAnonKey ? 'есть' : 'нет' } }); /* vx32 */

  const boot = () => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  };

  window.OKTO = {
    adapter: ADAPTER,
    text: TEXT,
    status: STATUS,
    store,
    auth: { register, login, logout, currentUser, requireUser, requireCurator, grantCurator },
    courses: { list: listCourses, published: publishedCourses, add: addCourse, togglePublished: toggleCoursePublished, remove: removeCourse, lessonsOf },
    projects: { list: listProjects, published: publishedProjects, add: addProject, togglePublished: toggleProjectPublished, remove: removeProject },
    tasks: { add: addSubmission, setStatus: setSubmissionStatus, forUser: submissionsForUser, all: () => ADAPTER.backend.submissions() },
    journal: { rows: journalRows, progressFor },
    percentOf,
  };

  if (isBrowser) boot();
})();
