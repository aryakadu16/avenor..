
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory;
  } else {
    root.AV = factory(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (win) {

  const C = win.AVENOR_CONFIG || {};
  const API = (C.API_URL || 'http://localhost:4000').replace(/\/$/, '');
  const EMAIL = /^\S+@\S+\.\S+$/;

  // Detect the Supabase browser library
  const supabaseLib = win.supabase;
  const createClient =
    supabaseLib && typeof supabaseLib.createClient === 'function'
      ? supabaseLib.createClient
      : null;

  const configured = !!(
    C.SUPABASE_URL &&
    C.SUPABASE_ANON_KEY &&
    createClient
  );

  // Create Supabase client
  const sb = configured
    ? createClient.call(supabaseLib, C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
    : null;

  const err = (message, options) =>
    Object.assign(new Error(message), options);

  function need() {
    if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY) {
      throw err(
        'Supabase URL or publishable key is missing from config.js.',
        { code: 'not_configured' }
      );
    }

    if (!createClient) {
      throw err(
        'Supabase library is not loaded. Check the Supabase script in index.html.',
        { code: 'library_missing' }
      );
    }

    if (!sb) {
      throw err('Supabase authentication could not initialize.', {
        code: 'not_configured'
      });
    }
  }

  function validate(mode, f) {
    const e = {};

    if (mode === 'up' && (f.name || '').trim().length < 2) {
      e.an = 'Enter your full name.';
    }

    if (!EMAIL.test((f.email || '').trim())) {
      e.ae = 'Enter a valid email address.';
    }

    if (mode !== 'forgot') {
      const p = f.password || '';

      if (mode === 'up') {
        if (p.length < 8) {
          e.ap = 'Password must be at least 8 characters.';
        } else if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) {
          e.ap = 'Use at least one letter and one number.';
        }
      } else if (!p) {
        e.ap = 'Enter your password.';
      }
    }

    return e;
  }

  function mapError(x) {
    const c = (x && (x.code || x.error_code)) || '';
    const m = ((x && x.message) || '').toLowerCase();

    if (c === 'not_configured' || c === 'library_missing') {
      return x.message;
    }

    if (c === 'invalid_credentials' || m.includes('invalid login')) {
      return 'Incorrect email or password.';
    }

    if (
      c === 'user_already_exists' ||
      c === 'duplicate' ||
      m.includes('already registered') ||
      m.includes('already been registered')
    ) {
      return 'An account with this email already exists. Sign in instead.';
    }

    if (c === 'email_not_confirmed' || m.includes('not confirmed')) {
      return 'Confirm your email address first. Check your inbox.';
    }

    if (c === 'weak_password') {
      return 'That password is too weak. Use a longer, less common password.';
    }

    if (
      c === 'over_request_rate_limit' ||
      c === 'over_email_send_rate_limit' ||
      (x && x.status === 429)
    ) {
      return 'Too many attempts. Please wait a minute and try again.';
    }

    if (c === 'validation_failed' || c === 'email_address_invalid') {
      return 'Enter a valid email address.';
    }

    if (
      !x ||
      x.status === 0 ||
      x.status === undefined ||
      m.includes('fetch') ||
      m.includes('network') ||
      x.status >= 500
    ) {
      return 'Cannot reach the authentication service. Check your connection and try again.';
    }

    return 'Something went wrong. Please try again.';
  }

  async function signUp(name, email, password) {
    need();

    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: name.trim()
        }
      }
    });

    if (error) throw error;

    if (
      data.user &&
      Array.isArray(data.user.identities) &&
      data.user.identities.length === 0
    ) {
      throw err('duplicate', { code: 'duplicate' });
    }

    return {
      session: data.session || null,
      needsConfirm: !data.session
    };
  }

  async function signIn(email, password) {
    need();

    const { data, error } = await sb.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (error) throw error;

    return data.session;
  }

  async function signOut() {
    if (!sb) return;

    try {
      await sb.auth.signOut();
    } catch (e) {
      // Preserve existing sign-out behavior
    }
  }

  async function resetPassword(email) {
    need();

    const { error } = await sb.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: win.location.origin + win.location.pathname
      }
    );

    if (error) throw error;
  }

  async function session() {
    if (!sb) return null;

    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    return data.session;
  }

  function onAuth(cb) {
    if (sb) {
      return sb.auth.onAuthStateChange(cb);
    }

    return null;
  }

  function toSess(s) {
    const u = s.user;

    return {
      mode: 'user',
      id: u.id,
      email: u.email,
      name:
        (u.user_metadata && u.user_metadata.full_name) ||
        (u.email || '').split('@')[0]
    };
  }

  async function api(path, opts) {
    opts = opts || {};

    const s = await session();

    if (!s) {
      throw err('Please sign in.', { status: 401 });
    }

    let r;

    try {
      r = await win.fetch(API + path, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.headers || {}),
          Authorization: 'Bearer ' + s.access_token
        }
      });
    } catch (e) {
      throw err('Cannot reach the AVENOR server.', { status: 0 });
    }

    const j = await r.json().catch(() => ({}));

    if (r.status === 401) {
      await signOut();
      throw err('Your session has expired. Please sign in again.', {
        status: 401
      });
    }

    if (r.status === 403) {
      throw err('You do not have permission to do that.', {
        status: 403
      });
    }

    if (r.status === 503) {
      throw err(
        (j.error && j.error.message) || 'Service unavailable.',
        { status: 503 }
      );
    }

    if (!r.ok) {
      throw err(
        (j.error && j.error.message) || 'Request failed.',
        {
          status: r.status,
          details: j.error && j.error.details
        }
      );
    }

    return j.data;
  }

  return {
    configured,
    validate,
    mapError,
    signUp,
    signIn,
    signOut,
    resetPassword,
    session,
    onAuth,
    init: session,
    toSess,
    api
  };

});
