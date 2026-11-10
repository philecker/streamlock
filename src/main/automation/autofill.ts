// Sign-in form filling, kept free of Electron so it can be unit tested.
//
// The fill script never submits a form: you stay in control of the final
// click, and a page that changes shape simply ends up unfilled instead of
// misfiring. It is re-run every second while a service window is open, so it
// also catches two-step sign-ins (email first, then a password box appears).

export interface FillResult {
  /** An email/username box was filled on this pass. */
  email: boolean
  /** A password box was filled on this pass. */
  password: boolean
  /** A visible password box exists (filled or not), i.e. this is a sign-in page. */
  hasPasswordField: boolean
}

/** Is `url` a page we may put credentials into for a service? Exact host match over https only. */
export function isFillAllowed(url: string, allowedHosts: readonly string[]): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && allowedHosts.includes(u.hostname)
  } catch {
    return false
  }
}

/**
 * Checks an address the user typed for a service's PIN page. Returns the
 * normalized URL, or an error message. Only the service's own domains are
 * accepted, so saved passwords can never be filled on some other site.
 */
export function checkSettingsUrl(raw: string, allowedHosts: readonly string[]): { ok: true; url: string } | { ok: false; error: string } {
  const text = raw.trim()
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return { ok: false, error: 'That is not a web address.' }
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'Use an https:// address.' }
  if (!allowedHosts.includes(u.hostname)) {
    return { ok: false, error: `Use an address on ${allowedHosts.join(', ')}.` }
  }
  if (u.username || u.password) return { ok: false, error: 'That is not a web address.' }
  return { ok: true, url: u.toString() }
}

/**
 * True when `url` is the PIN settings page (or a page under it). Compares
 * origin and path, ignoring a trailing slash and the query string. A hash is
 * compared only when the settings URL uses one (Plex is a single-page app
 * whose pages live in the hash).
 */
export function isSettingsPage(url: string, settingsUrl: string): boolean {
  try {
    const a = new URL(url)
    const b = new URL(settingsUrl)
    if (a.origin !== b.origin) return false
    const trim = (p: string) => p.replace(/\/+$/, '') || '/'
    const ap = trim(a.pathname)
    const bp = trim(b.pathname)
    if (ap !== bp && !ap.startsWith(`${bp}/`)) return false
    if (b.hash && b.hash !== '#') return a.hash.startsWith(b.hash)
    return true
  } catch {
    return false
  }
}

/**
 * Script run inside a page (or frame). Fills only empty, visible boxes and
 * only the kinds asked for. Searches inside shadow DOM too, since some sites
 * build their sign-in forms out of web components.
 */
export function buildFillScript(email: string, password: string, want: { email: boolean; password: boolean }): string {
  // Values are embedded as JSON literals, never concatenated as code.
  return `(() => {
  const EMAIL = ${JSON.stringify(email)};
  const PASSWORD = ${JSON.stringify(password)};
  const WANT_EMAIL = ${want.email ? 'true' : 'false'};
  const WANT_PASSWORD = ${want.password ? 'true' : 'false'};

  const all = (root, out = []) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'INPUT') out.push(el);
      if (el.shadowRoot) all(el.shadowRoot, out);
    }
    return out;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly;
  };
  const set = (el, value) => {
    el.focus && el.focus();
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.blur && el.blur();
  };
  const attr = (el, name) => (el.getAttribute(name) || '').toLowerCase();
  const hint = (el) => [attr(el, 'name'), attr(el, 'id'), attr(el, 'autocomplete'), attr(el, 'aria-label'), attr(el, 'placeholder')].join(' ');
  const TEXTISH = ['', 'text', 'email', 'tel'];
  const USERISH = /(^|[^a-z])(e-?mail|user(name)?|login|account|identifier|userid)([^a-z]|$)|username|userloginid|account_name/;
  const NOT_USER = /(search|code|otp|one-time|zip|postal|phone-code|captcha|pin)/;

  const inputs = all(document).filter(visible);
  // Account-password boxes only. PIN entry boxes are often type=password too:
  // skip anything short, numeric, or labeled as a PIN/code.
  const isPinBox = (el) => {
    const max = Number(el.getAttribute('maxlength') || 0);
    return (max > 0 && max <= 8) || attr(el, 'inputmode') === 'numeric' || NOT_USER.test(hint(el)) || /one-time-code/.test(attr(el, 'autocomplete'));
  };
  const passwords = inputs.filter((el) => attr(el, 'type') === 'password' && !isPinBox(el));
  const texts = inputs.filter((el) => TEXTISH.includes(attr(el, 'type')));

  let emailEl = null;
  if (WANT_EMAIL) {
    emailEl =
      texts.find((el) => attr(el, 'type') === 'email' && !el.value) ||
      texts.find((el) => /username|email/.test(attr(el, 'autocomplete')) && !el.value) ||
      texts.find((el) => USERISH.test(hint(el)) && !NOT_USER.test(hint(el)) && !el.value) ||
      null;
    // Fallback: the text box just before the password box on a sign-in form.
    if (!emailEl && passwords[0]) {
      const before = texts.filter((el) => el.compareDocumentPosition(passwords[0]) & 4 && !NOT_USER.test(hint(el)));
      const cand = before[before.length - 1];
      if (cand && !cand.value) emailEl = cand;
    }
  }
  const pwEl = WANT_PASSWORD ? passwords.find((el) => !el.value) || null : null;

  if (emailEl) set(emailEl, EMAIL);
  if (pwEl) set(pwEl, PASSWORD);
  return { email: !!emailEl, password: !!pwEl, hasPasswordField: passwords.length > 0 };
})()`
}
