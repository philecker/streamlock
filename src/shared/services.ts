// Catalog of supported services. URLs point at each service's own PIN/profile
// settings page. They are plain constants so a site redesign is a one-line fix.
// NOTE: verify each URL against the live site before relying on it.

export type ServiceId = 'netflix' | 'disney' | 'hulu' | 'max' | 'paramount' | 'peacock' | 'prime' | 'discovery' | 'plex' | 'roku'

export interface ServiceDef {
  id: ServiceId
  name: string
  mono: string
  /** Page where the PIN is changed. */
  settingsUrl: string
  /** Hosts credentials may be filled on. Anything else is refused. */
  allowedHosts: string[]
  /** What the PIN locks, shown in the UI. */
  scope: string
  /** Accent for the service's letter tile, close to the service's main color. */
  color: string
}

export const SERVICES: readonly ServiceDef[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    color: '#FF4D55',
    mono: 'N',
    settingsUrl: 'https://www.netflix.com/account/profiles',
    allowedHosts: ['www.netflix.com', 'netflix.com'],
    scope: 'Profile Lock per profile'
  },
  {
    id: 'disney',
    name: 'Disney+',
    color: '#4D8DFF',
    mono: 'D+',
    settingsUrl: 'https://www.disneyplus.com/edit-profiles',
    allowedHosts: ['www.disneyplus.com', 'disneyplus.com'],
    scope: 'Profile PIN per profile'
  },
  {
    id: 'hulu',
    name: 'Hulu',
    color: '#1CE783',
    mono: 'H',
    settingsUrl: 'https://secure.hulu.com/account/profiles',
    allowedHosts: ['secure.hulu.com', 'auth.hulu.com', 'www.hulu.com'],
    scope: 'PIN Protection (account)'
  },
  {
    id: 'max',
    name: 'HBO Max',
    color: '#B48CFF',
    mono: 'HM',
    // Profile picker → Manage Profiles → Lock Profile / Reset Profile PIN.
    settingsUrl: 'https://play.hbomax.com/',
    allowedHosts: ['play.hbomax.com', 'auth.hbomax.com', 'www.hbomax.com', 'hbomax.com'],
    scope: 'Profile PIN per profile'
  },
  {
    id: 'paramount',
    name: 'Paramount+',
    color: '#2E6BFF',
    mono: 'P+',
    // Account → Parental Controls → Edit.
    settingsUrl: 'https://www.paramountplus.com/account/',
    allowedHosts: ['www.paramountplus.com', 'paramountplus.com'],
    scope: 'Parental controls PIN (account)'
  },
  {
    id: 'peacock',
    name: 'Peacock',
    color: '#FFC21A',
    mono: 'P',
    settingsUrl: 'https://www.peacocktv.com/account',
    allowedHosts: ['www.peacocktv.com', 'peacocktv.com'],
    scope: 'Profile PIN per profile'
  },
  {
    id: 'prime',
    name: 'Prime Video',
    color: '#33C2F0',
    mono: 'PV',
    settingsUrl: 'https://www.amazon.com/gp/video/settings/parental-controls',
    allowedHosts: ['www.amazon.com', 'amazon.com', 'www.primevideo.com'],
    scope: 'Account PIN'
  },
  {
    id: 'discovery',
    name: 'Discovery+',
    color: '#5AA9FF',
    mono: 'DS',
    // Profile picker → Edit Profiles → Lock profile / Reset Profile PIN.
    settingsUrl: 'https://www.discoveryplus.com/',
    allowedHosts: ['www.discoveryplus.com', 'discoveryplus.com', 'auth.discoveryplus.com'],
    scope: 'Profile PIN per profile'
  },
  {
    id: 'plex',
    name: 'Plex',
    color: '#F0B53A',
    mono: 'Px',
    settingsUrl: 'https://app.plex.tv/desktop/#!/settings/plex-home',
    allowedHosts: ['app.plex.tv', 'plex.tv'],
    scope: 'Admin + managed users'
  },
  {
    id: 'roku',
    name: 'The Roku Channel',
    color: '#9B5CFF',
    mono: 'R',
    // Roku account PIN: purchases and The Roku Channel parental controls.
    settingsUrl: 'https://my.roku.com/account/pin',
    allowedHosts: ['my.roku.com', 'www.roku.com', 'roku.com'],
    scope: 'Roku account PIN'
  }
]

export const SERVICE_IDS = SERVICES.map((s) => s.id) as readonly ServiceId[]

export function getService(id: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.id === id)
}

export function isServiceId(id: unknown): id is ServiceId {
  return typeof id === 'string' && SERVICE_IDS.includes(id as ServiceId)
}
