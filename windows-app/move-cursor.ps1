param(
    [string]$Text = ""
)

# Debug: log what we received
$logPath = Join-Path $PSScriptRoot "cursor-debug.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logPath -Value "$timestamp | Received Text: '$Text' | Length: $($Text.Length)"

# Use Win32 API for cursor movement (works from hidden/background processes)
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32Cursor {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);
}
"@

# Add necessary assemblies for Screen info
Add-Type -AssemblyName System.Windows.Forms

# Get screen dimensions
$screenWidth = [Win32Cursor]::GetSystemMetrics(0)  # SM_CXSCREEN
$screenHeight = [Win32Cursor]::GetSystemMetrics(1)  # SM_CYSCREEN

Add-Content -Path $logPath -Value "$timestamp | Screen: ${screenWidth}x${screenHeight}"

function Get-CursorPosition {
    $point = New-Object Win32Cursor+POINT
    [Win32Cursor]::GetCursorPos([ref]$point) | Out-Null
    return $point
}

function Set-CursorPosition {
    param([int]$X, [int]$Y)
    [Win32Cursor]::SetCursorPos($X, $Y) | Out-Null
}

function Move-MouseDirection {
    param(
        [ValidateSet(
            "Up", "Down", "Left", "Right",
            "UpRight", "UpLeft", "DownRight", "DownLeft"
        )]
        [string]$Direction,

        [int]$pixels = 150
    )

    # current position using Win32 API
    $start = Get-CursorPosition
    $startX = $start.X
    $startY = $start.Y

    Add-Content -Path $logPath -Value "$timestamp | Start position: ($startX, $startY) | Direction: $Direction | Pixels: $pixels"

    # basic deltas
    $dx = 0
    $dy = 0

    switch ($Direction) {
        "Up" { $dx = 0; $dy = - $pixels }
        "Down" { $dx = 0; $dy = $pixels }
        "Left" { $dx = - $pixels; $dy = 0 }
        "Right" { $dx = $pixels; $dy = 0 }

        "UpRight" { $dx = $pixels; $dy = - $pixels }
        "UpLeft" { $dx = - $pixels; $dy = - $pixels }
        "DownRight" { $dx = $pixels; $dy = $pixels }
        "DownLeft" { $dx = - $pixels; $dy = $pixels }
    }

    $destX = $startX + $dx
    $destY = $startY + $dy

    # clamp to monitor bounds
    $destX = [math]::Min([math]::Max($destX, 0), $screenWidth - 1)
    $destY = [math]::Min([math]::Max($destY, 0), $screenHeight - 1)

    Add-Content -Path $logPath -Value "$timestamp | Moving to: ($destX, $destY)"

    # Move cursor with animation
    Move-CursorLine -startX $startX -startY $startY -endX $destX -endY $destY -steps 50
}

# Function to move cursor between two points using Win32 API
function Move-CursorLine {
    param(
        [int]$startX,
        [int]$startY,
        [int]$endX,
        [int]$endY,
        [int]$steps
    )
    
    for ($i = 0; $i -le $steps; $i++) {
        $x = [int]($startX + (($endX - $startX) * $i / $steps))
        $y = [int]($startY + (($endY - $startY) * $i / $steps))
        Set-CursorPosition -X $x -Y $y
        Start-Sleep -Milliseconds 5
    }

    # Verify final position
    $final = Get-CursorPosition
    Add-Content -Path $logPath -Value "$timestamp | Final position: ($($final.X), $($final.Y))"
}

# Function to draw letter A (modified to move upward-right)
function Draw-LetterA {
    Move-MouseDirection -Direction UpRight -pixels 50
}

# Function to draw letter B (modified to move upward-left)
function Draw-LetterB {
    Move-MouseDirection -Direction UpLeft -pixels 50
}

# Function to draw letter C (modified to move downward-left)
function Draw-LetterC {
    Move-MouseDirection -Direction DownLeft -pixels 50
}

# Function to draw letter D (modified to move downward-right)
function Draw-LetterD {
    Move-MouseDirection -Direction DownRight -pixels 50
}

# Move cursor based on the answer letter (A-E)
# Just uses the first character of $Text
$answer = $Text.Substring(0, 1).ToUpper()

Add-Content -Path $logPath -Value "$timestamp | Executing movement for answer: $answer"

Start-Sleep -Milliseconds 100

switch ($answer) {
    "A" { Draw-LetterA }
    "B" { Draw-LetterB }
    "C" { Draw-LetterC }
    "D" { Draw-LetterD }
   
    default {
        Add-Content -Path $logPath -Value "$timestamp | Unknown answer: $answer - no cursor movement."
    }
}

Add-Content -Path $logPath -Value "$timestamp | Cursor movement finished."
