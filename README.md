# Approval alert

DeepSeek Harness has two requests that park a turn until you answer: **approval**
(`approval/request`) and **question** (`ask_user_question` →
`user-questions/request`). Both only show up inside the DSH window, so a DSH
running in the background can sit blocked for many minutes without any visible
sign.

This plugin fires three desktop signals the moment either request appears:

- a **topmost popup** in the bottom-right corner — a dark card naming the kind,
  the tool and its reason, or the first question plus how many there are; it
  closes itself after 60 seconds;
- the **system alert sound**;
- the **taskbar button flashes** until the popup closes.

| Approval | Question |
|---|---|
| ![Approval alert](docs/approval-sample.png) | ![Question alert](docs/question-sample.png) |

## Install

```sh
dsh plugin --profile <profile> add github:Stontar/dsh-approval-alert
```

Then switch the bundle on under **Plugins**. No restart is needed for the Host
half; developed and tested against DSH 0.2.2-rc.3.

## Behaviour

- One alert per request; repeated requests of the same kind within 1.5 seconds
  are collapsed, and approval alerts and question alerts never suppress each
  other.
- The popup text is `Reason: …` for an approval and `Question: … (N questions)`
  for a question; a window without a console is fine — the popup is drawn by a
  short-lived PowerShell process next to the host.
- It never decides anything: the original answerer still resolves the request,
  and the plugin cannot approve, deny, or answer for you.

## Limits

- **Windows desktop only.** It locates the DSH window by title and drives
  WinForms/PowerShell, which has no equivalent elsewhere.
- Remote and headless hosts have no window to flash and no desktop to draw on,
  so nothing is shown.
- Under the **Full access** permission policy DSH asks for no approvals at all,
  so approval alerts never appear; questions are unaffected and still alert.
- Every channel writes to `%LOCALAPPDATA%\dsh-approval-alert\alert.log` (cleared
  past 256 KB), so a silently failed alert leaves evidence.

## Turn it off

Disable or remove the bundle in **Plugins**; the listener, the popup and the log
writer go away.

## More detail

`docs/DETAIL.md` (Chinese) records the implementation notes and the verification
log: why `ctx.on('approval/request')` never fires and `internal/dispatch` is used
instead, why the PowerShell child process must not be `detached` on Windows, and
how the popup measures and wraps its text.
