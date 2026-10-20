// Microsoft account sign-in using the "device code" method:
// the app shows a short code, you type it at microsoft.com/link, and you're signed in.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Authflow, Titles } = require('prismarine-auth')
const store = require('./store')

const FLOW = { flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo' }

function cacheDir (id) {
  const d = path.join(store.P.auth, id)
  fs.mkdirSync(d, { recursive: true })
  return d
}

function friendly (err) {
  const m = String(err && (err.message || err))
  if (/404|NOT_FOUND|does not own|profile/i.test(m)) return 'This Microsoft account does not seem to own Minecraft: Java Edition (or has no Java profile name yet).'
  if (/expired|authorization_pending|timed out/i.test(m)) return 'The sign-in code expired. Please try again.'
  return 'Sign-in failed: ' + m
}

let pending = null

// Starts a new sign-in. `onCode` receives { code, url } to show to the user.
async function addAccount (onCode) {
  const id = crypto.randomUUID()
  const token = crypto.randomUUID()
  pending = token
  const flow = new Authflow(id, cacheDir(id), FLOW, (resp) => {
    onCode({ code: resp.user_code, url: resp.verification_uri || 'https://www.microsoft.com/link', expiresIn: resp.expires_in })
  })
  try {
    const res = await flow.getMinecraftJavaToken({ fetchProfile: true })
    if (pending !== token) throw new Error('cancelled')
    if (!res.profile || !res.profile.id) throw new Error('profile')
    const data = store.get()
    data.accounts = data.accounts.filter(a => a.uuid !== res.profile.id)
    data.accounts.push({ id, name: res.profile.name, uuid: res.profile.id })
    data.activeAccount = id
    store.save()
    return { id, name: res.profile.name, uuid: res.profile.id }
  } catch (e) {
    fs.rmSync(cacheDir(id), { recursive: true, force: true })
    if (String(e.message) === 'cancelled') throw new Error('Sign-in cancelled.')
    throw new Error(friendly(e))
  }
}

function cancel () { pending = null }

function removeAccount (id) {
  const data = store.get()
  data.accounts = data.accounts.filter(a => a.id !== id)
  if (data.activeAccount === id) data.activeAccount = data.accounts[0] ? data.accounts[0].id : null
  store.save()
  fs.rmSync(path.join(store.P.auth, id), { recursive: true, force: true })
}

// Returns the login details Minecraft needs (refreshes silently from cache).
async function getLaunchAuth (onCode) {
  const data = store.get()
  const acc = data.accounts.find(a => a.id === data.activeAccount)
  if (!acc) throw new Error('Please sign in with your Microsoft account first (top right).')
  // If the saved sign-in has expired, Microsoft asks for a new code; show it to the user.
  const flow = new Authflow(acc.id, cacheDir(acc.id), FLOW, (resp) => {
    if (onCode) onCode({ code: resp.user_code, url: resp.verification_uri || 'https://www.microsoft.com/link', reauth: acc.name })
  })
  let res
  try { res = await flow.getMinecraftJavaToken({ fetchProfile: true }) } catch (e) { throw new Error(friendly(e)) }
  if (res.profile.name !== acc.name) { acc.name = res.profile.name; store.save() }
  return {
    access_token: res.token,
    client_token: acc.id,
    uuid: res.profile.id,
    name: res.profile.name,
    user_properties: '{}',
    meta: { type: 'msa', demo: false }
  }
}

module.exports = { addAccount, cancel, removeAccount, getLaunchAuth }
