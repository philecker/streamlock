import { useAppState } from './useAppState'
import { Setup } from './screens/Setup'
import { Unlock } from './screens/Unlock'
import { Popover } from './screens/Popover'
import { SettingsView } from './screens/Settings'
import { RecoveryKey } from './screens/RecoveryKey'

export function App() {
  const state = useAppState()
  const view = window.location.hash === '#settings' ? 'settings' : 'popover'
  if (!state) return null

  if (state.vault === 'missing') return <Setup state={state} />
  if (state.vault === 'locked') return <Unlock state={state} />
  if (state.recoveryKey) return <RecoveryKey recoveryKey={state.recoveryKey} />
  return view === 'settings' ? <SettingsView state={state} /> : <Popover state={state} />
}
