Option Explicit
Dim fso, shell, root, helper, host, code, result, dataRoot, output
On Error Resume Next
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
If Err.Number <> 0 Then WScript.Quit 1
root = fso.GetParentFolderName(WScript.ScriptFullName)
helper = fso.BuildPath(root, "HexthonLauncher.vbs")
host = fso.BuildPath(fso.GetSpecialFolder(0), "System32\wscript.exe")
code = ""
If WScript.Arguments.Count <> 0 Then code = "LAUNCHER_INVALID_COMMAND"
If InStr(helper, "%") > 0 Then code = "LAUNCHER_UNSUPPORTED_PATH"
If Not fso.FileExists(helper) Then code = "LAUNCHER_HELPER_MISSING"
If code = "" Then
  Err.Clear
  result = shell.Run(Chr(34) & host & Chr(34) & " //B //NoLogo " & Chr(34) & helper & Chr(34) & " start", 0, True)
  If Err.Number = 0 Then WScript.Quit result
  code = "LAUNCHER_HOST_FAILED"
End If
Err.Clear
dataRoot = fso.BuildPath(shell.ExpandEnvironmentStrings("%APPDATA%"), "Hexthon")
If Not fso.FolderExists(dataRoot) Then fso.CreateFolder dataRoot
Set output = fso.CreateTextFile(fso.BuildPath(dataRoot, "launcher-status.json"), True, False)
output.Write "{""schemaVersion"":1,""action"":""start"",""status"":""failed"",""code"":""" & code & """,""source"":""wrapper"",""startupVerified"":false}"
output.Close
WScript.Quit 1
