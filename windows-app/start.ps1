# PowerShell script to start the Windows V1 Windows application

Write-Host "Starting Windows V1 Windows Application..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Keyboard Shortcuts:" -ForegroundColor Yellow
Write-Host "  Ctrl+Shift+U  - Capture screen and process with AI" -ForegroundColor Cyan
Write-Host "  Ctrl+Shift+P  - Automatically type the last AI answer" -ForegroundColor Cyan
Write-Host ""
Write-Host "The application will run in the background." -ForegroundColor Gray
Write-Host "Use the system tray icon for additional options." -ForegroundColor Gray
Write-Host ""
Write-Host "Note: For automatic typing, focus on the target application before pressing Ctrl+Shift+P" -ForegroundColor Yellow
Write-Host ""

# Start the application
npm start
