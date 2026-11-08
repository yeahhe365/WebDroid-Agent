import { ArrowRight, Check, Loader2, Lock, Usb } from 'lucide-react'
import type { BusyTask } from '../lib/busyTask'
import { useAppCopy } from './AppContext'
import { Button } from './primitives'
import { isWebUsbSupported } from '../adapters/webUsbSupport'

export type SetupHomeProps = {
  busyTask: BusyTask | null
  deviceConnected: boolean
  hasModelConfig: boolean
  onConnectDevice: () => void
  onConfigureModel: () => void
  onEnterWorkspace: () => void
  onSkipToWorkspace: () => void
}

export function SetupHome({
  busyTask,
  deviceConnected,
  hasModelConfig,
  onConnectDevice,
  onConfigureModel,
  onEnterWorkspace,
  onSkipToWorkspace,
}: SetupHomeProps) {
  const copy = useAppCopy()
  const webUsbSupported = isWebUsbSupported()
  const agentReady = deviceConnected && hasModelConfig
  const connecting = busyTask?.id === 'connect-device'

  const steps = [
    {
      id: 'device',
      done: deviceConnected,
      current: !deviceConnected,
      title: copy.setupStepDeviceTitle,
      body: copy.setupStepDeviceBody,
      hint: copy.setupRequirementBrowser,
      actionLabel: deviceConnected ? copy.setupStepDeviceDone : copy.setupStepDeviceAction,
      onAction: onConnectDevice,
      disabled: deviceConnected || connecting || !webUsbSupported,
      loading: connecting,
    },
    {
      id: 'model',
      done: hasModelConfig,
      current: deviceConnected && !hasModelConfig,
      title: copy.setupStepModelTitle,
      body: copy.setupStepModelBody,
      hint: copy.setupRequirementModel,
      actionLabel: hasModelConfig ? copy.setupStepModelDone : copy.setupStepModelAction,
      onAction: onConfigureModel,
      disabled: hasModelConfig,
      loading: false,
    },
    {
      id: 'task',
      done: agentReady,
      current: agentReady,
      title: copy.setupStepTaskTitle,
      body: copy.setupStepTaskBody,
      hint: '',
      actionLabel: agentReady ? copy.setupStepTaskAction : copy.setupStepTaskLocked,
      onAction: onEnterWorkspace,
      disabled: !agentReady,
      loading: false,
    },
  ] as const

  return (
    <section className="setup-home" aria-label={copy.setupHomeAria}>
      <header className="setup-home-head">
        <div className="setup-home-heading">
          <h2>{copy.setupHomeTitle}</h2>
          <p className="setup-home-intro">{copy.setupHomeIntro}</p>
        </div>
        <Button variant="ghost" size="sm" className="setup-home-skip" onClick={onSkipToWorkspace}>
          {copy.setupSkipToWorkspace}
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </header>

      <div className="setup-home-progress" aria-hidden="true">
        {steps.map((step) => (
          <span
            key={step.id}
            className={step.done ? 'is-done' : step.current ? 'is-current' : undefined}
          />
        ))}
      </div>

      {!webUsbSupported ? (
        <div className="setup-home-banner warn" role="status">
          <Usb size={16} aria-hidden="true" />
          <span>{copy.setupWebUsbMissing}</span>
        </div>
      ) : null}

      <ol className="setup-home-steps">
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              className={[
                'setup-home-step',
                step.done ? 'is-done' : '',
                step.current ? 'is-current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={step.disabled}
              aria-current={step.current ? 'step' : undefined}
              onClick={step.onAction}
            >
              <span className="setup-home-step-index" aria-hidden="true">
                {step.done ? <Check size={16} /> : index + 1}
              </span>
              <span className="setup-home-step-body">
                <span className="setup-home-step-title">{step.title}</span>
                <span className="setup-home-step-text">{step.body}</span>
                {step.hint ? <span className="setup-home-step-hint">{step.hint}</span> : null}
              </span>
              <span className="setup-home-step-tail">
                {step.loading ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : step.done ? (
                  <>
                    <Check size={15} aria-hidden="true" />
                    <span>{step.actionLabel}</span>
                  </>
                ) : step.current ? (
                  <span className="setup-home-cta is-solid">
                    {step.actionLabel}
                    <ArrowRight size={14} aria-hidden="true" />
                  </span>
                ) : step.disabled ? (
                  <>
                    <Lock size={14} aria-hidden="true" />
                    <span>{step.actionLabel}</span>
                  </>
                ) : (
                  <span className="setup-home-cta is-quiet">
                    {step.actionLabel}
                    <ArrowRight size={14} aria-hidden="true" />
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
