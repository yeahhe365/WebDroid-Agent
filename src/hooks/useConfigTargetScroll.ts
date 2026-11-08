import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { CONFIG_TARGET_IDS, type ConfigTarget } from '../components/configTargets'

export function useConfigTargetScroll(
  configSidebarOpen: boolean,
  setConfigSidebarOpen: Dispatch<SetStateAction<boolean>>,
) {
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null)

  useEffect(() => {
    if (!configSidebarOpen || !configTarget) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      const element = document.getElementById(CONFIG_TARGET_IDS[configTarget])
      const details =
        element instanceof HTMLDetailsElement
          ? element
          : element?.querySelector<HTMLDetailsElement>('details')
      if (details) {
        details.open = true
      }
      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
      setConfigTarget(null)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [configSidebarOpen, configTarget])

  const openConfigTarget = useCallback(
    (target: ConfigTarget) => {
      setConfigSidebarOpen(true)
      setConfigTarget(target)
    },
    [setConfigSidebarOpen],
  )

  return openConfigTarget
}
