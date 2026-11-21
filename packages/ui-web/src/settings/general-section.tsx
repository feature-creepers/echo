import { useDevice } from '../device/device.tsx'
import { Button } from '../primitives/button.tsx'
import { Switch } from '../primitives/switch.tsx'
import { SettingGroup, SettingRow } from './rows.tsx'
import { useAbout } from './use-about.ts'

/** How the app starts and stops on this computer, and where it keeps what it writes. */
export function GeneralSection({ productName }: { productName: string }) {
  const { settings, change, host } = useDevice()
  const about = useAbout(host)

  return (
    <div className="grid gap-10">
      <SettingGroup title="Starting">
        <SettingRow title="Open at login" detail={`${productName} starts when you sign in to this computer, out of sight, ready for your shortcut.`}>
          <Switch label="Open at login" on={settings.app.launchAtLogin} onChange={(launchAtLogin) => change({ app: { launchAtLogin } })} />
        </SettingRow>
        <SettingRow title="Start in the background" detail="Opens in the tray, without the window. Your shortcut, or a click on the tray, brings it forward.">
          <Switch label="Start in the background" on={settings.app.startHidden} onChange={(startHidden) => change({ app: { startHidden } })} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Closing the window">
        <SettingRow
          title="Keep running in the tray"
          detail={`Closing the window leaves ${productName} in the tray, so your shortcut still works. Off, closing the window quits.`}
        >
          <Switch label="Keep running in the tray" on={settings.app.closeToTray} onChange={(closeToTray) => change({ app: { closeToTray } })} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Data">
        <SettingRow
          title="Kept on this computer"
          detail={`Your conversations, what ${productName} remembers, its voice models and these settings. Nothing leaves this computer except what is sent to the AI program you use. Delete the folder to start again from the first launch.`}
          stacked
        >
          <div className="flex items-center gap-3">
            <code className="min-w-0 flex-1 truncate font-mono text-text-soft text-xs" title={about?.dataFolder}>
              {about?.dataFolder ?? '…'}
            </code>
            <Button disabled={!host} onClick={() => void host?.openDataFolder()}>
              Open the folder
            </Button>
          </div>
        </SettingRow>
      </SettingGroup>
    </div>
  )
}
