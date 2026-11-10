import { describe, expect, it } from 'vitest'
import { buildFillScript, checkSettingsUrl, isFillAllowed, isSettingsPage } from '../src/main/automation/autofill'

const NETFLIX = ['www.netflix.com', 'netflix.com']

describe('isFillAllowed', () => {
  it('allows the service hosts over https', () => {
    expect(isFillAllowed('https://www.netflix.com/login', NETFLIX)).toBe(true)
  })
  it('refuses http, look-alikes and userinfo tricks', () => {
    expect(isFillAllowed('http://www.netflix.com/login', NETFLIX)).toBe(false)
    expect(isFillAllowed('https://netflix.com.evil.io/login', NETFLIX)).toBe(false)
    expect(isFillAllowed('https://evil.io/www.netflix.com', NETFLIX)).toBe(false)
    expect(isFillAllowed('https://www.netflix.com@evil.io/', NETFLIX)).toBe(false)
    expect(isFillAllowed('https://xn--netflx-yua.com/', NETFLIX)).toBe(false)
    expect(isFillAllowed('not a url', NETFLIX)).toBe(false)
  })
})

describe('checkSettingsUrl', () => {
  it('accepts the service own pages, adding https:// if missing', () => {
    expect(checkSettingsUrl('www.netflix.com/account/profiles', NETFLIX)).toEqual({ ok: true, url: 'https://www.netflix.com/account/profiles' })
  })
  it('refuses other sites, http and embedded logins', () => {
    expect(checkSettingsUrl('https://evil.io/x', NETFLIX).ok).toBe(false)
    expect(checkSettingsUrl('http://www.netflix.com/x', NETFLIX).ok).toBe(false)
    expect(checkSettingsUrl('https://a:b@www.netflix.com/x', NETFLIX).ok).toBe(false)
    expect(checkSettingsUrl('::::', NETFLIX).ok).toBe(false)
  })
})

describe('isSettingsPage', () => {
  it('matches the page and pages under it, ignoring query and trailing slash', () => {
    const s = 'https://www.netflix.com/account/profiles'
    expect(isSettingsPage('https://www.netflix.com/account/profiles/', s)).toBe(true)
    expect(isSettingsPage('https://www.netflix.com/account/profiles/ABC?x=1', s)).toBe(true)
    expect(isSettingsPage('https://www.netflix.com/browse', s)).toBe(false)
    expect(isSettingsPage('https://www.netflix.com/account/profilesX', s)).toBe(false)
  })
  it('compares the hash for single-page apps like Plex', () => {
    const s = 'https://app.plex.tv/desktop/#!/settings/plex-home'
    expect(isSettingsPage('https://app.plex.tv/desktop/#!/settings/plex-home', s)).toBe(true)
    expect(isSettingsPage('https://app.plex.tv/desktop/#!/', s)).toBe(false)
  })
})

// ---- a tiny fake DOM, enough to run the fill script in Node ----
interface FakeInput {
  tagName: 'INPUT'
  attrs: Record<string, string>
  value: string
  idx: number
  shadowRoot?: { querySelectorAll: () => unknown[] }
}
function dom(specs: (Record<string, string> | { shadow: Record<string, string>[] })[]) {
  const flat: FakeInput[] = []
  const mk = (attrs: Record<string, string>): FakeInput => {
    const el: FakeInput & Record<string, unknown> = { tagName: 'INPUT', attrs, value: '', idx: flat.length }
    el.getAttribute = (n: string) => attrs[n] ?? null
    el.getBoundingClientRect = () => ({ width: attrs.hidden ? 0 : 100, height: 20 })
    el.dispatchEvent = () => true
    el.compareDocumentPosition = (other: FakeInput) => (other.idx > el.idx ? 4 : 2)
    flat.push(el)
    return el
  }
  const top: unknown[] = []
  for (const s of specs) {
    if ('shadow' in s) {
      const host = { tagName: 'DIV', shadowRoot: { querySelectorAll: () => (s as { shadow: Record<string, string>[] }).shadow.map(mk) } }
      top.push(host)
    } else top.push(mk(s as Record<string, string>))
  }
  const document = { querySelectorAll: () => top }
  return { document, flat }
}
function run(script: string, document: unknown) {
  const fn = new Function('document', 'getComputedStyle', 'Event', `return ${script}`)
  return fn(document, () => ({ visibility: 'visible', display: 'block' }), class {
    constructor(public type: string) {}
  })
}
const both = { email: true, password: true }

describe('buildFillScript', () => {
  it('embeds hostile values as data, not code', () => {
    const evil = `"); globalThis.pwned = true; ("`
    const { document, flat } = dom([{ type: 'email' }, { type: 'password' }])
    const res = run(buildFillScript(evil, `</script><img src=x onerror=alert(1)>`, both), document)
    expect(res).toEqual({ email: true, password: true, hasPasswordField: true })
    expect(flat[0]?.value).toBe(evil)
    expect(flat[1]?.value).toBe(`</script><img src=x onerror=alert(1)>`)
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined()
  })

  it('handles two-step sign-in: email now, password later', () => {
    const step1 = dom([{ type: 'text', name: 'userLoginId' }])
    expect(run(buildFillScript('me@x.com', 'pw', both), step1.document)).toEqual({ email: true, password: false, hasPasswordField: false })
    const step2 = dom([{ type: 'password', name: 'password' }])
    expect(run(buildFillScript('me@x.com', 'pw', { email: false, password: true }), step2.document).password).toBe(true)
    expect(step2.flat[0]?.value).toBe('pw')
  })

  it('finds fields inside shadow DOM', () => {
    const { document, flat } = dom([{ shadow: [{ type: 'email' }, { type: 'password' }] }])
    expect(run(buildFillScript('a', 'b', both), document)).toMatchObject({ email: true, password: true })
    expect(flat.map((f) => f.value)).toEqual(['a', 'b'])
  })

  it('falls back to the text box just before the password box', () => {
    const { document, flat } = dom([{ type: 'text', id: 'account_name_text_field' }, { type: 'password' }])
    run(buildFillScript('apple@id', 'pw', both), document)
    expect(flat[0]?.value).toBe('apple@id')
    const plain = dom([{ type: 'text', id: 'f1' }, { type: 'password', id: 'f2' }])
    run(buildFillScript('u', 'p', both), plain.document)
    expect(plain.flat[0]?.value).toBe('u')
  })

  it('never types the account password into PIN boxes', () => {
    const { document, flat } = dom([
      { type: 'password', maxlength: '1' },
      { type: 'password', inputmode: 'numeric' },
      { type: 'password', name: 'pin' },
      { type: 'password', autocomplete: 'one-time-code' }
    ])
    const res = run(buildFillScript('e', 'secret', both), document)
    expect(res).toEqual({ email: false, password: false, hasPasswordField: false })
    expect(flat.every((f) => f.value === '')).toBe(true)
  })

  it('leaves search and code boxes alone', () => {
    const { document, flat } = dom([{ type: 'text', name: 'search' }, { type: 'text', name: 'verificationCode' }])
    run(buildFillScript('e', 'p', both), document)
    expect(flat.every((f) => f.value === '')).toBe(true)
  })

  it('skips hidden fields and fields that already have a value', () => {
    const { document, flat } = dom([{ type: 'email', hidden: '1' }, { type: 'email' }])
    run(buildFillScript('e', 'p', both), document)
    expect(flat.map((f) => f.value)).toEqual(['', 'e'])
  })
})
