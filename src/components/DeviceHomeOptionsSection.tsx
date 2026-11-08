import { Settings2 } from 'lucide-react'
import { useId } from 'react'
import type { SafetyStrictness } from '../lib/actionRisk'
import type { AppCopy } from '../lib/appCopy'
import type { DeviceControlActions, DeviceControlOptions } from '../lib/deviceControlTypes'

export type DeviceHomeOptionsSectionProps = {
  actions: Pick<
    DeviceControlActions,
    | 'onConfirmSensitiveActionsChange'
    | 'onPreferAdbKeyboardChange'
    | 'onSafetyStrictnessChange'
    | 'onUnrestrictedModeChange'
  >
  copy: AppCopy
  memoryEnabled: boolean
  onMemoryEnabledChange: (value: boolean) => void
  onScreenBlackoutDuringAutoControlChange: (value: boolean) => void
  options: Pick<
    DeviceControlOptions,
    'confirmSensitiveActions' | 'preferAdbKeyboard' | 'safetyStrictness' | 'unrestrictedMode'
  >
  sectionId?: string
  screenBlackoutDuringAutoControl: boolean
}

export function DeviceHomeOptionsSection({
  actions,
  copy,
  memoryEnabled,
  onMemoryEnabledChange,
  onScreenBlackoutDuringAutoControlChange,
  options,
  sectionId,
  screenBlackoutDuringAutoControl,
}: DeviceHomeOptionsSectionProps) {
  const preferAdbKeyboardInputId = useId()
  const confirmSensitiveActionsInputId = useId()
  const unrestrictedModeInputId = useId()
  const memoryInputId = useId()
  const screenBlackoutInputId = useId()
  const safetyStrictnessInputId = useId()
  const enabledOptionCount = [
    options.preferAdbKeyboard,
    options.confirmSensitiveActions,
    options.unrestrictedMode,
    options.safetyStrictness !== 'balanced',
    memoryEnabled,
    screenBlackoutDuringAutoControl,
  ].filter(Boolean).length

  return (
    <section className="config-panel-group" id={sectionId} aria-label={copy.deviceOptions}>
      <div className="config-section-heading">
        <div className="panel-title">
          <Settings2 size={18} />
          <h2>{copy.deviceOptions}</h2>
        </div>
        <span className="config-section-badge count">
          {copy.actionToolsSummary(enabledOptionCount, 6)}
        </span>
      </div>
      <div className="home-device-options-panel">
        <label className="toggle" htmlFor={preferAdbKeyboardInputId}>
          <input
            id={preferAdbKeyboardInputId}
            name="preferAdbKeyboard"
            type="checkbox"
            checked={options.preferAdbKeyboard}
            onChange={(event) => actions.onPreferAdbKeyboardChange(event.target.checked)}
          />
          <span>{copy.useAdbKeyboard}</span>
        </label>
        <label className="toggle" htmlFor={confirmSensitiveActionsInputId}>
          <input
            id={confirmSensitiveActionsInputId}
            name="confirmSensitiveActions"
            type="checkbox"
            checked={options.confirmSensitiveActions}
            disabled={options.unrestrictedMode}
            onChange={(event) => actions.onConfirmSensitiveActionsChange(event.target.checked)}
          />
          <span>{copy.confirmSensitiveActions}</span>
        </label>
        <label
          className="toggle"
          htmlFor={unrestrictedModeInputId}
          title={options.unrestrictedMode ? copy.unrestrictedModeEnabledBanner : undefined}
        >
          <input
            id={unrestrictedModeInputId}
            name="unrestrictedMode"
            type="checkbox"
            checked={options.unrestrictedMode}
            // `onUnrestrictedModeChange` is wired (in App.tsx) to a confirmation
            // dialog when enabling, so we pass the raw checkbox value through and
            // let the parent decide whether to actually apply it.
            onChange={(event) => actions.onUnrestrictedModeChange(event.target.checked)}
          />
          <span>{copy.unrestrictedMode}</span>
        </label>
        <div className="config-inline-field" title={copy.safetyStrictnessHelp}>
          <label htmlFor={safetyStrictnessInputId}>{copy.safetyStrictness}</label>
          <select
            id={safetyStrictnessInputId}
            name="safetyStrictness"
            value={options.safetyStrictness}
            onChange={(event) =>
              actions.onSafetyStrictnessChange(event.target.value as SafetyStrictness)
            }
          >
            <option value="relaxed">{copy.safetyStrictnessRelaxed}</option>
            <option value="balanced">{copy.safetyStrictnessBalanced}</option>
            <option value="strict">{copy.safetyStrictnessStrict}</option>
          </select>
        </div>
        <label className="toggle" htmlFor={memoryInputId} title={copy.memoryHelp}>
          <input
            id={memoryInputId}
            name="memoryEnabled"
            type="checkbox"
            checked={memoryEnabled}
            onChange={(event) => onMemoryEnabledChange(event.target.checked)}
          />
          <span>{copy.memory}</span>
        </label>
        <label
          className="toggle"
          htmlFor={screenBlackoutInputId}
          title={copy.screenBlackoutDuringAutoControlHelp}
        >
          <input
            id={screenBlackoutInputId}
            name="screenBlackoutDuringAutoControl"
            type="checkbox"
            checked={screenBlackoutDuringAutoControl}
            onChange={(event) => onScreenBlackoutDuringAutoControlChange(event.target.checked)}
          />
          <span>{copy.screenBlackoutDuringAutoControl}</span>
        </label>
      </div>
    </section>
  )
}
