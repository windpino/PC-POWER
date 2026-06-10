Set WshShell = CreateObject("WScript.Shell")
currentDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "cmd.exe /c node """ & currentDir & "\agent.js"" >> """ & currentDir & "\agent.log"" 2>&1", 0, false
