Option Explicit
' Silent launcher. A requested process is not a verified running application.
' No shell commands, focus changes, input simulation, policy changes or elevation.
Dim fso, shell, action, appData, dataRoot, root, executable, arguments, source, workingDirectory, commandLine, result, environment
On Error Resume Next
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
If Err.Number <> 0 Then WScript.Quit 1
On Error GoTo 0

action = "invalid"
appData = shell.ExpandEnvironmentStrings("%APPDATA%")
dataRoot = fso.BuildPath(appData, "Hexthon")
root = fso.GetParentFolderName(WScript.ScriptFullName)
If WScript.Arguments.Count <> 1 Then Fail "LAUNCHER_INVALID_COMMAND", "none"
If WScript.Arguments(0) <> "start" And WScript.Arguments(0) <> "stop" Then Fail "LAUNCHER_INVALID_COMMAND", "none"
action = WScript.Arguments(0)
If Not SafePath(root) Or Not SafePath(appData) Then Fail "LAUNCHER_UNSUPPORTED_PATH", "none"

executable = ""
source = "none"
workingDirectory = ActiveDirectory()
If workingDirectory <> "" Then
  executable = fso.BuildPath(workingDirectory, "Hexthon.exe")
  source = "update"
ElseIf PackagedDirectory(root) Then
  workingDirectory = root
  executable = fso.BuildPath(root, "Hexthon.exe")
  source = "packaged"
ElseIf fso.FileExists(fso.BuildPath(root, "node_modules\electron\dist\electron.exe")) And fso.FileExists(fso.BuildPath(root, "package.json")) And fso.FileExists(fso.BuildPath(root, "src\main.cjs")) Then
  workingDirectory = root
  executable = fso.BuildPath(root, "node_modules\electron\dist\electron.exe")
  source = "workspace"
Else
  Fail "LAUNCHER_SOURCE_MISSING", "none"
End If

If action = "start" Then
  arguments = "--assist"
Else
  arguments = "--quit"
End If
If source = "workspace" Then arguments = QuoteArgument(root) & " " & arguments
If Not SafePath(executable) Or Not SafePath(workingDirectory) Then Fail "LAUNCHER_UNSUPPORTED_PATH", source
commandLine = QuoteArgument(executable) & " " & arguments

On Error Resume Next
shell.CurrentDirectory = workingDirectory
If Err.Number <> 0 Then
  Err.Clear
  Fail "LAUNCHER_DIRECTORY_UNAVAILABLE", source
End If
Set environment = shell.Environment("Process")
environment.Remove "ELECTRON_RUN_AS_NODE"
Err.Clear
result = ExecuteHidden(commandLine)
If Err.Number <> 0 Then
  Err.Clear
  Fail "LAUNCHER_LAUNCH_FAILED", source
End If
On Error GoTo 0
WriteStatus "requested", "", source
WScript.Quit 0

Function ExecuteHidden(value)
  ExecuteHidden = shell.Run(value, 0, False)
End Function

Function SafePath(value)
  ' WshShell.Run expands %variables%, even inside quoted paths. Reject such
  ' paths rather than launch a different target. Spaces, Unicode, & and () work.
  SafePath = Len(value) > 0 And InStr(value, Chr(34)) = 0 And InStr(value, "%") = 0 And InStr(value, vbCr) = 0 And InStr(value, vbLf) = 0
End Function

Function QuoteArgument(value)
  Dim suffix, index
  suffix = ""
  index = Len(value)
  Do While index > 0
    If Mid(value, index, 1) <> "\" Then Exit Do
    suffix = suffix & "\"
    index = index - 1
  Loop
  QuoteArgument = Chr(34) & value & suffix & Chr(34)
End Function

Function PackagedDirectory(directory)
  PackagedDirectory = fso.FileExists(fso.BuildPath(directory, "Hexthon.exe")) And fso.FileExists(fso.BuildPath(directory, "resources\app\package.json")) And fso.FileExists(fso.BuildPath(directory, "resources\app\src\main.cjs")) And fso.FileExists(fso.BuildPath(directory, "resources\app\src\controller.cjs"))
End Function

Function ActiveDirectory()
  Dim pointer, stream, key, pattern, candidate
  ActiveDirectory = ""
  On Error Resume Next
  pointer = fso.BuildPath(dataRoot, "updates\active-path.txt")
  If Not fso.FileExists(pointer) Then Exit Function
  If fso.GetFile(pointer).Size > 128 Then Exit Function
  Set stream = fso.OpenTextFile(pointer, 1, False, 0)
  If Err.Number <> 0 Then Err.Clear: Exit Function
  key = stream.ReadAll
  stream.Close
  If Err.Number <> 0 Then Err.Clear: Exit Function
  Set pattern = New RegExp
  pattern.Pattern = "^\d+\.\d+\.\d+-[a-f0-9]{12}-[a-f0-9]{8}$"
  pattern.Global = False
  pattern.IgnoreCase = False
  If Not pattern.Test(key) Then Exit Function
  ' Explicit character check also rejects a final newline accepted by $.
  If InStr(key, vbCr) > 0 Or InStr(key, vbLf) > 0 Then Exit Function
  candidate = fso.BuildPath(dataRoot, "updates\packages\" & key & "\Hexthon-win32-x64")
  If SafePath(candidate) And PackagedDirectory(candidate) Then ActiveDirectory = candidate
  Err.Clear
  On Error GoTo 0
End Function

Sub Fail(code, selectedSource)
  WriteStatus "failed", code, selectedSource
  WScript.Quit 1
End Sub

Sub WriteStatus(status, code, selectedSource)
  Dim output, codeJson
  On Error Resume Next
  If Not fso.FolderExists(dataRoot) Then fso.CreateFolder dataRoot
  If code = "" Then codeJson = "null" Else codeJson = Chr(34) & code & Chr(34)
  Set output = fso.CreateTextFile(fso.BuildPath(dataRoot, "launcher-status.json"), True, False)
  output.Write "{""schemaVersion"":1,""action"":""" & action & """,""status"":""" & status & """,""code"":" & codeJson & ",""source"":""" & selectedSource & """,""startupVerified"":false}"
  output.Close
  Err.Clear
  On Error GoTo 0
End Sub
