import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Combination, Modifier } from '../keys.ts'
import { WINDOWS_POWERSHELL } from '../program.ts'
import { lastingHelper } from './helpers.ts'
import type { ScreenSystem } from './system.ts'

/**
 * Windows: UI Automation, the system's accessibility tree, read and operated by a helper written in C# and hosted
 * by Windows PowerShell, which every Windows has. The C# is compiled once into the helper's folder and loaded from
 * there after, since compiling takes a few seconds. Keys and text go through `SendInput`, text as Unicode, so any
 * character is typed whatever the keyboard's layout.
 */

const VIRTUAL_KEYS: Record<string, number> = {
  enter: 0x0d,
  escape: 0x1b,
  tab: 0x09,
  backspace: 0x08,
  delete: 0x2e,
  space: 0x20,
  arrowup: 0x26,
  arrowdown: 0x28,
  arrowleft: 0x25,
  arrowright: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  insert: 0x2d,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`f${index + 1}`, 0x70 + index]))
}

const MODIFIER_KEYS: Record<Modifier, number> = { control: 0x11, shift: 0x10, alt: 0x12, meta: 0x5b }

/** A combination as the helper presses it: the modifiers' virtual keys, then a virtual key or a character it finds the key of. */
function windowsKeys({ modifiers, key }: Combination): { modifiers: number[]; key: number; character: string } {
  const named = VIRTUAL_KEYS[key]
  if (named !== undefined) return { modifiers: modifiers.map((modifier) => MODIFIER_KEYS[modifier]), key: named, character: '' }
  // A letter or a digit is its own virtual key, in capitals; another character is found on the keyboard's layout.
  const plain = /^[a-z0-9]$/.test(key) ? key.toUpperCase().charCodeAt(0) : 0
  return { modifiers: modifiers.map((modifier) => MODIFIER_KEYS[modifier]), key: plain, character: plain === 0 ? key : '' }
}

/** The helper's C#: every question is answered here, PowerShell only carries the lines. */
const BRIDGE = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

public static class EchoScreen {
  [StructLayout(LayoutKind.Sequential)] struct LastInput { public uint Size; public uint Time; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public ushort Key; public ushort Scan; public uint Flags; public uint Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int X; public int Y; public uint Data; public uint Flags; public uint Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Keyboard; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public InputUnion Data; }
  delegate bool EnumProc(IntPtr window, IntPtr data);

  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput info);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attached, uint to, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] static extern short VkKeyScan(char character);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr context, uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect value, int size);

  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 64 };
  static readonly Dictionary<string, AutomationElement> Elements = new Dictionary<string, AutomationElement>();
  static readonly Dictionary<string, IntPtr> WindowOf = new Dictionary<string, IntPtr>();
  static int made = 0;

  public static string Answer(string line) {
    object id = null;
    try {
      var question = Json.Deserialize<Dictionary<string, object>>(line);
      id = question["id"];
      var input = question.ContainsKey("input") && question["input"] is Dictionary<string, object> ? (Dictionary<string, object>)question["input"] : new Dictionary<string, object>();
      var value = Dispatch((string)question["name"], input);
      return Json.Serialize(new Dictionary<string, object> { { "id", id }, { "ok", true }, { "value", value } });
    } catch (Exception failure) {
      var cause = failure.InnerException != null && failure is System.Reflection.TargetInvocationException ? failure.InnerException : failure;
      var words = cause is ElementNotAvailableException ? "The element is gone: look at the window again with desktop_look." : cause.Message;
      return Json.Serialize(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", words } });
    }
  }

  static object Dispatch(string name, Dictionary<string, object> input) {
    switch (name) {
      case "windows": return Windows();
      case "tree": return Tree(WindowIn(input), Convert.ToInt32(input["limit"]));
      case "inspect": return Inspect((string)input["key"]);
      case "focus": { var window = WindowIn(input); Front(window); Thread.Sleep(150); return Facts(window, GetForegroundWindow()); }
      case "click": Click((string)input["key"]); return null;
      case "type": TypeInto((string)input["key"], (string)input["text"], (bool)input["submit"]); return null;
      case "press": Press(WindowIn(input), (Dictionary<string, object>)input["keys"], input.ContainsKey("key") ? input["key"] as string : null); return null;
      case "scroll": Scroll(WindowIn(input), (string)input["direction"], Convert.ToDouble(input["screens"]), input.ContainsKey("key") ? input["key"] as string : null); return null;
      case "screenshot": return new Dictionary<string, object> { { "data", Picture(WindowIn(input)) }, { "mime", "image/png" } };
      case "idle": { var info = new LastInput(); info.Size = (uint)Marshal.SizeOf(info); if (!GetLastInputInfo(ref info)) return null; return (long)unchecked((uint)Environment.TickCount - info.Time); }
      case "open": Open((string)input["link"]); return null;
      default: throw new Exception("The helper does not know " + name + ".");
    }
  }

  static IntPtr WindowIn(Dictionary<string, object> input) {
    var id = (string)input["window"];
    long handle;
    if (!id.StartsWith("w") || !long.TryParse(id.Substring(1), out handle) || !IsWindow(new IntPtr(handle)))
      throw new Exception("There is no window " + id + " open now. Call desktop_windows for the windows open and their identifiers.");
    return new IntPtr(handle);
  }

  static string Title(IntPtr window) { var text = new StringBuilder(512); GetWindowText(window, text, 512); return text.ToString(); }

  static Rect Bounds(IntPtr window) {
    Rect rect;
    if (DwmGetWindowAttribute(window, 9, out rect, Marshal.SizeOf(typeof(Rect))) != 0) GetWindowRect(window, out rect);
    return rect;
  }

  // An app of the Store draws in a frame of another process: the app is the process of the window inside it.
  static uint ProcessOf(IntPtr window) {
    uint own;
    GetWindowThreadProcessId(window, out own);
    uint inner = 0;
    EnumChildWindows(window, (child, data) => { uint process; GetWindowThreadProcessId(child, out process); if (process != own) { inner = process; return false; } return true; }, IntPtr.Zero);
    try { if (inner != 0 && Process.GetProcessById((int)own).ProcessName.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) return inner; } catch { }
    return own;
  }

  static Dictionary<string, object> Facts(IntPtr window, IntPtr front) {
    var rect = Bounds(window);
    string program = "", app = "";
    try {
      var process = Process.GetProcessById((int)ProcessOf(window));
      program = process.ProcessName.ToLowerInvariant();
      // The name a person knows: the program's description, unless it reads like a file or a package's name, then its product's.
      try {
        var version = process.MainModule.FileVersionInfo;
        app = Named(version.FileDescription) ? version.FileDescription : Named(version.ProductName) ? version.ProductName : "";
      } catch { }
      if (string.IsNullOrWhiteSpace(app)) app = process.ProcessName;
    } catch { }
    return new Dictionary<string, object> {
      { "id", "w" + window.ToInt64() }, { "program", program }, { "app", app.Trim() }, { "title", Title(window) },
      { "bounds", new Dictionary<string, object> { { "x", rect.Left }, { "y", rect.Top }, { "width", rect.Right - rect.Left }, { "height", rect.Bottom - rect.Top } } },
      { "focused", window == front }, { "minimized", IsIconic(window) }
    };
  }

  static bool Named(string name) {
    return !string.IsNullOrWhiteSpace(name) && !name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && !System.Text.RegularExpressions.Regex.IsMatch(name.Trim(), @"^[A-Za-z0-9]+(\.[A-Za-z0-9]+)+$");
  }

  static List<object> Windows() {
    var found = new List<IntPtr>();
    EnumWindows((window, data) => {
      // Windows a person switches to: visible, owned by none, not a tool window, not hidden by the system, with a title.
      if (!IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero || (GetWindowLong(window, -20) & 0x80) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(window, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      if (Title(window).Length > 0) found.Add(window);
      return true;
    }, IntPtr.Zero);
    var front = GetForegroundWindow();
    var list = new List<object>();
    foreach (var window in found) list.Add(Facts(window, front));
    return list;
  }

  static List<object> Tree(IntPtr window, int limit) {
    var id = "w" + window.ToInt64();
    var gone = new List<string>();
    foreach (var pair in WindowOf) if (pair.Value == window) gone.Add(pair.Key);
    foreach (var key in gone) { WindowOf.Remove(key); Elements.Remove(key); }
    var request = new CacheRequest();
    request.Add(AutomationElement.NameProperty);
    request.Add(AutomationElement.ControlTypeProperty);
    request.Add(AutomationElement.IsPasswordProperty);
    request.Add(AutomationElement.IsEnabledProperty);
    request.Add(AutomationElement.IsOffscreenProperty);
    request.Add(AutomationElement.AutomationIdProperty);
    request.Add(AutomationElement.HelpTextProperty);
    request.Add(AutomationElement.IsValuePatternAvailableProperty);
    request.Add(ValuePattern.ValueProperty);
    request.TreeFilter = Automation.ControlViewCondition;
    request.AutomationElementMode = AutomationElementMode.Full;
    var nodes = new List<object>();
    var root = AutomationElement.FromHandle(window);
    Walk(new TreeWalker(Automation.ControlViewCondition), request, root, 0, nodes, limit, window);
    return nodes;
  }

  static object Cached(AutomationElement element, AutomationProperty property) {
    try { return element.GetCachedPropertyValue(property, true); } catch { return null; }
  }

  static void Walk(TreeWalker walker, CacheRequest request, AutomationElement parent, int depth, List<object> nodes, int limit, IntPtr window) {
    if (depth > 40) return;
    AutomationElement child;
    try { child = walker.GetFirstChild(parent, request); } catch { return; }
    while (child != null && nodes.Count < limit) {
      if (!(Cached(child, AutomationElement.IsOffscreenProperty) is bool && (bool)Cached(child, AutomationElement.IsOffscreenProperty))) {
        var key = "k" + (++made);
        Elements[key] = child;
        WindowOf[key] = window;
        var password = Cached(child, AutomationElement.IsPasswordProperty) is bool && (bool)Cached(child, AutomationElement.IsPasswordProperty);
        var type = Cached(child, AutomationElement.ControlTypeProperty) as ControlType;
        var node = new Dictionary<string, object> {
          { "key", key }, { "role", type == null ? "" : type.ProgrammaticName }, { "name", (Cached(child, AutomationElement.NameProperty) as string) ?? "" },
          { "password", password }, { "enabled", !(Cached(child, AutomationElement.IsEnabledProperty) is bool) || (bool)Cached(child, AutomationElement.IsEnabledProperty) }, { "depth", depth }
        };
        var value = Cached(child, ValuePattern.ValueProperty) as string;
        if (!password && value != null) node["value"] = value.Length > 200 ? value.Substring(0, 200) : value;
        nodes.Add(node);
        Walk(walker, request, child, depth + 1, nodes, limit, window);
      }
      try { child = walker.GetNextSibling(child, request); } catch { break; }
    }
  }

  static AutomationElement Element(string key) {
    AutomationElement element;
    if (!Elements.TryGetValue(key, out element)) throw new Exception("That element is no longer known: look at the window again with desktop_look.");
    return element;
  }

  static object Inspect(string key) {
    AutomationElement element;
    if (!Elements.TryGetValue(key, out element)) return null;
    var current = element.Current;
    var hints = new List<object>();
    if (!string.IsNullOrEmpty(current.AutomationId)) hints.Add(current.AutomationId);
    if (!string.IsNullOrEmpty(current.HelpText)) hints.Add(current.HelpText);
    var facts = new Dictionary<string, object> {
      { "role", current.ControlType.ProgrammaticName }, { "name", current.Name ?? "" }, { "password", current.IsPassword }, { "enabled", current.IsEnabled },
      { "hints", hints }, { "window", "w" + WindowOf[key].ToInt64() }
    };
    object pattern;
    if (!current.IsPassword && element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
      var value = ((ValuePattern)pattern).Current.Value ?? "";
      facts["value"] = value.Length > 200 ? value.Substring(0, 200) : value;
    }
    return facts;
  }

  // Windows gives the front only to the app the person used last. The helper shares the input of the window in front
  // for a moment, which lets it hand the front over, then presses Alt alone if that was not enough. Keys and clicks
  // go to the window in front: when it is not this one, nothing is sent, so nothing lands in another app.
  static void Front(IntPtr window) {
    if (IsIconic(window)) ShowWindow(window, 9);
    if (GetForegroundWindow() == window) return;
    uint ignored;
    var front = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
    var own = GetCurrentThreadId();
    var attached = front != own && AttachThreadInput(own, front, true);
    BringWindowToTop(window);
    SetForegroundWindow(window);
    if (attached) AttachThreadInput(own, front, false);
    for (var tries = 0; tries < 10 && GetForegroundWindow() != window; tries++) {
      if (tries == 2) { Key(0x12, false); Key(0x12, true); SetForegroundWindow(window); }
      Thread.Sleep(50);
    }
    if (GetForegroundWindow() != window)
      throw new Exception("The window could not be brought to the front, so nothing was pressed in it. Ask the person to click it once, then try again.");
  }

  // A pattern that may wait on the app, such as a button that opens a dialog, is given a moment: the dialog then waits for the next look.
  static void Soon(Action work) {
    Exception failure = null;
    var thread = new Thread(() => { try { work(); } catch (Exception caught) { failure = caught; } });
    thread.IsBackground = true;
    thread.Start();
    if (thread.Join(3000) && failure != null) throw failure;
  }

  static void Click(string key) {
    var element = Element(key);
    object pattern;
    if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) { var invoke = (InvokePattern)pattern; Soon(() => invoke.Invoke()); return; }
    if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) { ((TogglePattern)pattern).Toggle(); return; }
    if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { ((SelectionItemPattern)pattern).Select(); return; }
    if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) {
      var expand = (ExpandCollapsePattern)pattern;
      if (expand.Current.ExpandCollapseState == ExpandCollapseState.Collapsed) expand.Expand(); else expand.Collapse();
      return;
    }
    Front(WindowOf[key]);
    System.Windows.Point point;
    if (!element.TryGetClickablePoint(out point)) {
      var box = element.Current.BoundingRectangle;
      point = new System.Windows.Point(box.Left + box.Width / 2, box.Top + box.Height / 2);
    }
    SetCursorPos((int)point.X, (int)point.Y);
    Mouse(0x0002, 0);
    Mouse(0x0004, 0);
  }

  static void TypeInto(string key, string text, bool submit) {
    var element = Element(key);
    object pattern;
    if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly) {
      ((ValuePattern)pattern).SetValue(text);
    } else {
      Front(WindowOf[key]);
      try { element.SetFocus(); } catch { }
      Press(new int[] { 0x11 }, 0x41);
      Text(text);
    }
    if (submit) {
      Front(WindowOf[key]);
      try { element.SetFocus(); } catch { }
      Press(new int[0], 0x0d);
    }
  }

  static void Press(IntPtr window, Dictionary<string, object> keys, string key) {
    Front(window);
    if (key != null) { try { Element(key).SetFocus(); } catch { } }
    var modifiers = new List<int>();
    foreach (var modifier in (System.Collections.IEnumerable)keys["modifiers"]) modifiers.Add(Convert.ToInt32(modifier));
    var virtualKey = Convert.ToInt32(keys["key"]);
    var character = (string)keys["character"];
    if (virtualKey == 0 && character.Length > 0) {
      var scanned = VkKeyScan(character[0]);
      if (scanned == -1 || modifiers.Count == 0) { Text(character); return; }
      virtualKey = scanned & 0xff;
      if ((scanned & 0x100) != 0 && !modifiers.Contains(0x10)) modifiers.Add(0x10);
    }
    Press(modifiers.ToArray(), virtualKey);
  }

  static void Scroll(IntPtr window, string direction, double screens, string key) {
    var element = key != null ? Element(key) : AutomationElement.FromHandle(window);
    object found;
    var scrolling = element.TryGetCurrentPattern(ScrollPattern.Pattern, out found) ? element : element.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.IsScrollPatternAvailableProperty, true));
    var times = Math.Max(1, (int)Math.Round(screens));
    object pattern;
    if (scrolling != null && scrolling.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern) && ((ScrollPattern)pattern).Current.VerticallyScrollable) {
      for (var time = 0; time < times; time++) ((ScrollPattern)pattern).ScrollVertical(direction == "down" ? ScrollAmount.LargeIncrement : ScrollAmount.LargeDecrement);
      return;
    }
    Front(window);
    var box = element.Current.BoundingRectangle;
    SetCursorPos((int)(box.Left + box.Width / 2), (int)(box.Top + box.Height / 2));
    Mouse(0x0800, (direction == "down" ? -120 : 120) * 3 * times);
  }

  static string Picture(IntPtr window) {
    Rect rect;
    GetWindowRect(window, out rect);
    int width = Math.Max(1, rect.Right - rect.Left), height = Math.Max(1, rect.Bottom - rect.Top);
    using (var bitmap = new Bitmap(width, height)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        var context = graphics.GetHdc();
        var drawn = PrintWindow(window, context, 2);
        graphics.ReleaseHdc(context);
        if (!drawn) graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height));
      }
      // A model sees no more than about 1600 pixels across: a larger picture costs more and shows no more.
      var scale = Math.Min(1.0, 1600.0 / Math.Max(width, height));
      using (var scaled = new Bitmap(bitmap, new Size(Math.Max(1, (int)(width * scale)), Math.Max(1, (int)(height * scale)))))
      using (var stream = new MemoryStream()) {
        scaled.Save(stream, ImageFormat.Png);
        return Convert.ToBase64String(stream.ToArray());
      }
    }
  }

  // The system refuses input to an app that runs with more rights than the helper, such as one started as administrator.
  static void Send(Input input) {
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) == 0)
      throw new Exception("The system did not take the key or the click (error " + Marshal.GetLastWin32Error() + "). An app started as administrator cannot be operated.");
  }

  // Opened as the shell opens it, by the app registered for the link's scheme. The core checked the link first.
  static void Open(string link) {
    try {
      Process.Start(new ProcessStartInfo(link) { UseShellExecute = true });
    } catch (System.ComponentModel.Win32Exception) {
      throw new Exception("No app on this computer opens " + link.Split(':')[0] + ": links.");
    }
  }

  static void Key(int key, bool up) {
    var extended = (key >= 0x21 && key <= 0x28) || key == 0x2d || key == 0x2e || key == 0x5b;
    var input = new Input { Type = 1 };
    input.Data.Keyboard = new KeyboardInput { Key = (ushort)key, Flags = (up ? 2u : 0u) | (extended ? 1u : 0u) };
    Send(input);
  }

  static void Press(int[] modifiers, int key) {
    foreach (var modifier in modifiers) Key(modifier, false);
    Key(key, false);
    Key(key, true);
    for (var index = modifiers.Length - 1; index >= 0; index--) Key(modifiers[index], true);
  }

  static void Text(string text) {
    foreach (var character in text) {
      if (character == '\r') continue;
      if (character == '\n') { Press(new int[0], 0x0d); continue; }
      foreach (var up in new[] { false, true }) {
        var input = new Input { Type = 1 };
        input.Data.Keyboard = new KeyboardInput { Scan = character, Flags = 4u | (up ? 2u : 0u) };
        Send(input);
      }
    }
  }

  static void Mouse(uint flags, int data) {
    var input = new Input { Type = 0 };
    input.Data.Mouse = new MouseInput { Flags = flags, Data = unchecked((uint)data) };
    Send(input);
  }
}
`

/** The PowerShell that loads the bridge, compiled once into `library`, and answers a line for each line it reads. */
const HOST = String.raw`
param([string]$Source, [string]$Library)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$names = 'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Drawing', 'System.Web.Extensions'
$assemblies = foreach ($name in $names) { [System.Reflection.Assembly]::LoadWithPartialName($name).Location }
if (-not (Test-Path -LiteralPath $Library)) {
  Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($Source)) -ReferencedAssemblies $assemblies -OutputAssembly $Library -OutputType Library
}
Add-Type -LiteralPath $Library
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  [Console]::Out.WriteLine([EchoScreen]::Answer($line))
  [Console]::Out.Flush()
}
`

export const win32: ScreenSystem = {
  async find() {
    try {
      await access(WINDOWS_POWERSHELL)
      return { available: true }
    } catch {
      return { available: false, problem: 'Windows PowerShell, which reads the other apps, was not found on this computer.' }
    }
  },
  helper(folder) {
    // The library is named after its source, so a new version of the bridge is compiled again, once.
    const version = createHash('sha256').update(BRIDGE).digest('hex').slice(0, 12)
    return lastingHelper(WINDOWS_POWERSHELL, async () => {
      await mkdir(folder, { recursive: true })
      const source = join(folder, `bridge-${version}.cs`)
      const host = join(folder, `host-${version}.ps1`)
      await writeFile(source, BRIDGE)
      await writeFile(host, HOST)
      return [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        host,
        '-Source',
        source,
        '-Library',
        join(folder, `bridge-${version}.dll`)
      ]
    })
  },
  keys: windowsKeys
}
