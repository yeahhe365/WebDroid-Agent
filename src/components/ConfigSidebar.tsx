import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useAppCopy } from './AppContext'
import { IconButton } from './primitives'
import type { ActionProtocol } from '../lib/actionProtocol'
import type { ModelConfig } from '../lib/openAiTypes'
import { CONFIG_TARGET_IDS, type ConfigTarget } from './configTargets'
import { DeviceHomeOptionsSection } from './DeviceHomeOptionsSection'
import { DevicePanel } from './DevicePanel'
import { DeviceToolsSection } from './DeviceToolsSection'
import type {
  DeviceControlActions,
  DeviceControlOptions,
  DeviceControlState,
} from '../lib/deviceControlTypes'
import { ModelPanel } from './ModelPanel'

export type ConfigSidebarProps = {
  deviceActions: DeviceControlActions
  deviceOptions: DeviceControlOptions
  deviceState: DeviceControlState
  isOpen: boolean
  memoryEnabled: boolean
  modelConfig: ModelConfig
  actionProtocol: ActionProtocol
  onActionProtocolChange: (value: ActionProtocol) => void
  onModelConfigChange: <Key extends keyof ModelConfig>(
    key: Key,
    value: ModelConfig[Key],
  ) => void
  onMemoryEnabledChange: (value: boolean) => void
  onScreenBlackoutDuringAutoControlChange: (value: boolean) => void
  onSelectTarget: (target: ConfigTarget) => void
  onStreamResponsesChange: (value: boolean) => void
  onToggleOpen: () => void
  screenBlackoutDuringAutoControl: boolean
  streamResponses: boolean
}

export function ConfigSidebar({
  deviceActions,
  deviceOptions,
  deviceState,
  isOpen,
  memoryEnabled,
  modelConfig,
  actionProtocol,
  onActionProtocolChange,
  onModelConfigChange,
  onMemoryEnabledChange,
  onScreenBlackoutDuringAutoControlChange,
  onSelectTarget: _onSelectTarget,
  onStreamResponsesChange,
  onToggleOpen,
  screenBlackoutDuringAutoControl,
  streamResponses,
}: ConfigSidebarProps) {
  const copy = useAppCopy()
  void _onSelectTarget

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onToggleOpen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onToggleOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div className="config-drawer-root">
      <button
        type="button"
        className="config-drawer-backdrop"
        aria-label={copy.closeConfigurationPanel}
        onClick={onToggleOpen}
      />
      <aside
        aria-label={copy.configurationPanel}
        className="panel config-panel config-panel-expanded config-drawer"
        role="dialog"
        aria-modal="true"
      >
        <div className="config-sidebar-header">
          <span className="config-sidebar-title">{copy.configurationPanel}</span>
          <IconButton
            size="md"
            aria-label={copy.closeConfigurationPanel}
            title={copy.closeConfigurationPanel}
            onClick={onToggleOpen}
            className="config-sidebar-toggle"
          >
            <X size={17} />
          </IconButton>
        </div>

        <div className="config-panel-content">
          <section
            className="config-panel-group"
            id={CONFIG_TARGET_IDS.model}
            aria-label={copy.model}
          >
            <ModelPanel
              copy={copy}
              actionProtocol={actionProtocol}
              modelConfig={modelConfig}
              onActionProtocolChange={onActionProtocolChange}
              onModelConfigChange={onModelConfigChange}
              onStreamResponsesChange={onStreamResponsesChange}
              streamResponses={streamResponses}
            />
          </section>

          <DevicePanel
            actions={deviceActions}
            copy={copy}
            sectionId={CONFIG_TARGET_IDS.device}
            state={deviceState}
          />

          <DeviceToolsSection
            actions={deviceActions}
            copy={copy}
            sectionId={CONFIG_TARGET_IDS.tools}
            state={deviceState}
          />

          <DeviceHomeOptionsSection
            actions={deviceActions}
            copy={copy}
            memoryEnabled={memoryEnabled}
            onMemoryEnabledChange={onMemoryEnabledChange}
            onScreenBlackoutDuringAutoControlChange={onScreenBlackoutDuringAutoControlChange}
            options={deviceOptions}
            sectionId={CONFIG_TARGET_IDS.options}
            screenBlackoutDuringAutoControl={screenBlackoutDuringAutoControl}
          />
        </div>
      </aside>
    </div>
  )
}
