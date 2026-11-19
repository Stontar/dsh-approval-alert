/**
 * dsh-approval-alert
 *
 * When DSH asks for an approval (e.g. the "workspace write" permission preset),
 * the request normally only appears inside the DSH window. This plugin listens
 * to the host's `approval/request` waterfall and, without taking part in the
 * decision, raises desktop signals that survive a hidden, console-less process:
 *
 *   1. a topmost alert window (no AUMID / notification-center dependency),
 *   2. the system exclamation sound (SystemSounds works headless),
 *   3. a taskbar flash of the DSH window.
 *
 * Every channel reports into a log file so failures are never silent.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LOG_DIR = join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? '.', 'dsh-approval-alert')
const LOG_FILE = process.env.DSH_ALERT_LOG || join(LOG_DIR, 'alert.log')

/** Append one diagnostic line, keeping the log small and never throwing. */
function log(line) {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    try {
      if (statSync(LOG_FILE).size > 262144) writeFileSync(LOG_FILE, '')
    } catch {
      /* no log yet */
    }
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\r\n`)
  } catch {
    /* logging must never break alerting */
  }
}

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$log = $env:DSH_ALERT_LOG
function Note($m) {
  try { Add-Content -LiteralPath $log -Value (('{0:o} {1}' -f (Get-Date), $m)) -Encoding UTF8 } catch {}
}
Note '--- alert start ---'

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -Namespace AlertNative -Name Win -MemberDefinition @'
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
[StructLayout(LayoutKind.Sequential)] public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }
public static IntPtr FindByTitle(string part) {
  IntPtr found = IntPtr.Zero;
  EnumWindows((h, l) => {
    if (!IsWindowVisible(h)) return true;
    int len = GetWindowTextLength(h);
    if (len == 0) return true;
    var sb = new System.Text.StringBuilder(len + 2);
    GetWindowText(h, sb, sb.Capacity);
    string title = sb.ToString();
    if (title.IndexOf(part, System.StringComparison.OrdinalIgnoreCase) >= 0) { found = h; return false; }
    return true;
  }, IntPtr.Zero);
  return found;
}
'@
  Note 'types=ok'
} catch { Note ('types=err ' + $_.Exception.Message) }

# 1) taskbar flash on the DSH window (located by window title: the window
#    belongs to a helper process, so process-name matching misses it)
$script:target = [IntPtr]::Zero
try {
  foreach ($part in @('DeepSeek Harness', 'DSH')) {
    $script:target = [AlertNative.Win]::FindByTitle($part)
    if ($script:target -ne [IntPtr]::Zero) { Note ('flash-target=' + $part + ' hwnd=' + $script:target); break }
  }
  if ($script:target -ne [IntPtr]::Zero) {
    $script:fi = New-Object AlertNative.Win+FLASHWINFO
    $script:fi.cbSize = [uint32][System.Runtime.InteropServices.Marshal]::SizeOf($script:fi)
    $script:fi.hwnd = $script:target
    $script:fi.dwFlags = 3
    $script:fi.uCount = 6
    $script:fi.dwTimeout = 0
    $null = [AlertNative.Win]::FlashWindowEx([ref]$script:fi)
    Note 'flash=ok'
  } else { Note 'flash=no-target' }
} catch { Note ('flash=err ' + $_.Exception.Message) }

# 2) sound (SystemSounds plays without a console)
try {
  [System.Media.SystemSounds]::Exclamation.Play()
  Note 'sound=ok'
} catch { Note ('sound=err ' + $_.Exception.Message) }

# 3) topmost alert window
try {
  try { $null = [AlertNative.Win]::SetProcessDPIAware() } catch {}

  $form = New-Object System.Windows.Forms.Form
  $form.AutoScaleDimensions = New-Object System.Drawing.SizeF(96, 96)
  $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
  $form.Text = '__TITLE__'
  $form.TopMost = $true
  $form.ShowInTaskbar = $false
  $form.FormBorderStyle = 'FixedToolWindow'
  $form.StartPosition = 'Manual'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ClientSize = New-Object System.Drawing.Size(460, 236)
  $form.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 32)
  $form.ForeColor = [System.Drawing.Color]::White

  $head = New-Object System.Windows.Forms.Label
  $head.Text = [char]0x25B6 + '  __HEAD__'
  $head.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 12, [System.Drawing.FontStyle]::Bold)
  $head.ForeColor = [System.Drawing.Color]::FromArgb(255, 196, 0)
  $head.SetBounds(18, 14, 424, 28)
  $form.Controls.Add($head)

  $body = New-Object System.Windows.Forms.Label
  $body.Text = '__BODY__'
  $body.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
  $body.SetBounds(18, 48, 424, 40)
  $form.Controls.Add($body)

  $btn = New-Object System.Windows.Forms.Button
  $btn.Text = '__BTN__'
  $btn.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
  $btn.SetBounds(348, 190, 94, 32)
  $btn.Add_Click({ $script:form.Close() })
  $form.Controls.Add($btn)

  # size the window to the wrapped text so nothing is ever clipped
  try {
    $measure = [System.Windows.Forms.TextRenderer]::MeasureText(
      $body.Text, $body.Font, (New-Object System.Drawing.Size(424, 4000)),
      [System.Windows.Forms.TextFormatFlags]::WordBreak)
    $need = [int]$measure.Height + 6
    if ($need -gt $body.Height) { $body.Height = $need }
  } catch {}
  $btn.Top = $body.Top + $body.Height + 14
  $form.ClientSize = New-Object System.Drawing.Size(460, ($btn.Top + $btn.Height + 16))

  # place against the bottom-right corner of the working area, using the real outer size
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Left = $screen.Right - $form.Width - 24
  $form.Top = $screen.Bottom - $form.Height - 24

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 60000
  $timer.Add_Tick({ $script:form.Close() })
  $timer.Start()

  # keep nudging the taskbar while the alert is up, in case the user missed the first flash
  if ($script:target -ne [IntPtr]::Zero) {
    $script:beats = 0
    $flash = New-Object System.Windows.Forms.Timer
    $flash.Interval = 7000
    $flash.Add_Tick({
      if ($script:beats -ge 8) { $script:flash.Stop(); return }
      $script:beats++
      try { $null = [AlertNative.Win]::FlashWindowEx([ref]$script:fi) } catch {}
    })
    $script:flash = $flash
    $flash.Start()
  }

  $script:form = $form
  $script:btn = $btn
  $script:body = $body
  $form.Add_Shown({
    $script:form.Activate()
    Note ('geom client=' + $script:form.ClientSize.Width + 'x' + $script:form.ClientSize.Height +
          ' dpi=' + $script:form.DeviceDpi +
          ' btnBottom=' + ($script:btn.Top + $script:btn.Height) +
          ' bodyBottom=' + ($script:body.Top + $script:body.Height) +
          ' outer=' + $script:form.Width + 'x' + $script:form.Height)
    if ($env:DSH_ALERT_SHOT) {
      try {
        Start-Sleep -Milliseconds 450
        $w = $script:form.ClientSize.Width
        $h = $script:form.ClientSize.Height
        $bmp = New-Object System.Drawing.Bitmap ($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.Clear($script:form.BackColor)
        foreach ($c in $script:form.Controls) {
          $cb = New-Object System.Drawing.Bitmap ($c.Width, $c.Height)
          $c.DrawToBitmap($cb, (New-Object System.Drawing.Rectangle 0, 0, $c.Width, $c.Height))
          $g.DrawImage($cb, $c.Left, $c.Top)
          $cb.Dispose()
        }
        $g.Dispose()
        $bmp.Save($env:DSH_ALERT_SHOT, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Note 'shot=ok'
      } catch { Note ('shot=err ' + $_.Exception.Message) }
      Start-Sleep -Milliseconds 300
      $script:form.Close()
    }
  })
  Note 'window=open'
  [void]$form.ShowDialog()
  Note 'window=closed'
} catch { Note ('window=err ' + $_.Exception.Message) }

Note '--- alert end ---'
`

/** PowerShell single-quoted literal escaping, collapsed to one line. */
function psText(value, max = 180) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/'/g, "''")
    .slice(0, max)
}

/** Build the PowerShell payload for one alert. */
export function buildScript(head, body) {
  return PS_SCRIPT
    .replaceAll('__TITLE__', psText('DSH 提醒', 40))
    .replaceAll('__HEAD__', psText(head, 60))
    .replaceAll('__BODY__', psText(body, 200))
    .replaceAll('__BTN__', '知道了')
}

export function notify(head, body) {
  const script = buildScript(head, body)
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      {
        // NOT detached: a detached Windows child of this host never executes its
        // script (verified: exit 0, no output, no window). unref is enough.
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, DSH_ALERT_LOG: LOG_FILE },
      },
    )
    child.on('error', (error) => log(`spawn-error ${error.message}`))
    child.unref()
    log(`notify head=${head} pid=${child.pid ?? '?'}`)
  } catch (error) {
    log(`spawn-throw ${error?.message ?? error}`)
  }
}

/**
 * The two requests that block a turn waiting for the human, and how each one
 * reads as desktop text. Both dispatch on an agent-scoped receiver.
 */
const INTERRUPTS = {
  'approval/request': (request) => ({
    head: `需要审批：${request?.toolName ?? '未知工具'}`,
    body: request?.reason
      ? `原因：${request.reason}`
      : '有操作正在等待你的批准，请回到 DSH 窗口处理。',
  }),
  'user-questions/request': (request) => {
    const questions = Array.isArray(request?.questions) ? request.questions : []
    const first = questions[0]?.question ?? ''
    const count = questions.length > 1 ? `（共 ${questions.length} 个问题）` : ''
    return {
      head: '需要你回答问题',
      body: first ? `问题：${first}${count}` : '有提问正在等待你的回答。',
    }
  },
}

/**
 * Read one interrupt request as desktop text.
 * @param name - Cordis event name of the interrupt.
 * @param request - the request payload the service dispatched.
 * @returns the alert headline and body, or `undefined` for other events.
 */
export function describeInterrupt(name, request) {
  return INTERRUPTS[name]?.(request)
}

/** The event names this plugin alerts on. */
const interruptNames = new Set(Object.keys(INTERRUPTS))

export const name = 'approval-alert'

export function apply(ctx) {
  let lastAt = 0
  let lastHead = ''

  /** Raise one alert, collapsing repeats of the same request. */
  const fire = (head, body) => {
    const now = Date.now()
    if (head === lastHead && now - lastAt <= 1500) return
    lastAt = now
    lastHead = head
    notify(head, body)
  }

  log(`plugin loaded pid=${process.pid}`)

  // Cordis broadcasts `internal/dispatch` synchronously BEFORE applying the
  // receiver filter in `_resolve`, so this sees requests the documented
  // listeners never receive: both services dispatch on an agent-scoped
  // receiver, and a listener outside that scope is filtered out (verified —
  // `{ global: true }` does not help either).
  ctx.on('internal/dispatch', (type, name, args) => {
    if (!interruptNames.has(name)) return
    const request = Array.isArray(args) ? args[0] : undefined
    const text = describeInterrupt(name, request)
    if (!text) return
    log(`dispatch observed type=${type} name=${name} head=${text.head}`)
    fire(text.head, text.body)
  })

  return () => log('plugin disposed')
}