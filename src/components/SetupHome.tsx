import { Bot, Check, Loader2, MessageSquare, Smartphone, Usb } from 'lucide-react'
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
      icon: Smartphone,
      title: copy.setupStepDeviceTitle,
      body: copy.setupStepDeviceBody,
      actionLabel: deviceConnected ? copy.setupStepDeviceDone : copy.setupStepDeviceAction,
      onAction: onConnectDevice,
      disabled: deviceConnected || connecting || !webUsbSupported,
      loading: connecting,
      primary: !deviceConnected,
    },
    {
      id: 'model',
      done: hasModelConfig,
      icon: Bot,
      title: copy.setupStepModelTitle,
      body: copy.setupStepModelBody,
      actionLabel: hasModelConfig ? copy.setupStepModelDone : copy.setupStepModelAction,
      onAction: onConfigureModel,
      disabled: hasModelConfig,
      loading: false,
      primary: deviceConnected && !hasModelConfig,
    },
    {
      id: 'task',
      done: agentReady,
      icon: MessageSquare,
      title: copy.setupStepTaskTitle,
      body: copy.setupStepTaskBody,
      actionLabel: agentReady ? copy.setupStepTaskAction : copy.setupStepTaskLocked,
      onAction: onEnterWorkspace,
      disabled: !agentReady,
      loading: false,
      primary: agentReady,
    },
  ] as const

  return (
    <section className="setup-home" aria-label={copy.setupHomeAria}>
      <div className="setup-home-hero">
        <img
          alt=""
          className="setup-home-logo"
          src="/webdroid-agent-logo-128.png"
          width={56}
          height={56}
        />
        <div className="setup-home-copy">
          <p className="eyebrow">{copy.setupHomeAria}</p>
          <h2>{copy.setupHomeTitle}</h2>
          <p className="setup-home-intro">{copy.setupHomeIntro}</p>
          <p className="setup-home-tagline">{copy.appTagline}</p>
        </div>
      </div>

      {!webUsbSupported ? (
        <div className="setup-home-banner warn" role="status">
          <Usb size={16} aria-hidden="true" />
          <span>{copy.setupWebUsbMissing}</span>
        </div>
      ) : null}

      <ol className="setup-home-steps">
        {steps.map((step, index) => {
          const Icon = step.icon
          return (
            <li
              key={step.id}
              className={[
                'setup-home-step',
                step.done ? 'is-done' : '',
                step.primary ? 'is-primary' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="setup-home-step-index" aria-hidden="true">
                {step.done ? <Check size={16} /> : <span>{index + 1}</span>}
              </div>
              <div className="setup-home-step-icon" aria-hidden="true">
                <Icon size={18} />
              </div>
              <div className="setup-home-step-body">
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              <div className="setup-home-step-action">
                <Button
                  variant={step.primary ? 'primary' : step.done ? 'secondary' : 'secondary'}
                  size="sm"
                  disabled={step.disabled}
                  onClick={step.onAction}
                  aria-label={step.actionLabel}
                >
                  {step.loading ? (
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                  ) : step.done ? (
                    <Check size={16} aria-hidden="true" />
                  ) : null}
                  {step.actionLabel}
                </Button>
              </div>
            </li>
          )
        })}
      </ol>

      <ul className="setup-home-requirements">
        <li>{copy.setupRequirementBrowser}</li>
        <li>{copy.setupRequirementUsb}</li>
        <li>{copy.setupRequirementModel}</li>
      </ul>

      <div className="setup-home-footer">
        <Button variant="ghost" size="sm" onClick={onSkipToWorkspace}>
          {copy.setupSkipToWorkspace}
        </Button>
      </div>
    </section>
  )
}
