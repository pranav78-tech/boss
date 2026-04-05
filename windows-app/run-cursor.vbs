' VBScript to run PowerShell invisibly for cursor drawing
Dim objArgs, textToDisplay, scriptPath
Dim objShell

' Get the text parameter from command line
Set objArgs = WScript.Arguments
If objArgs.Count > 1 Then
    textToDisplay = objArgs(0)
    scriptPath = objArgs(1)
Else
    ' Exit if no text provided
    WScript.Quit
End If

' Create Shell object
Set objShell = CreateObject("WScript.Shell")

' Run PowerShell script invisibly
' Quotes around the scriptPath handle spaces in directories (e.g., 'windows v1-win32-x64')
objShell.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -NonInteractive -NoProfile -File """ & scriptPath & """ -Text """ & textToDisplay & """", 0, False

' Clean up
Set objShell = Nothing
