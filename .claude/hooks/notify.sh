#!/bin/bash
# Claude Code notification hook - triggers macOS notification when Claude needs attention

# Read the JSON from stdin
input=$(cat)

# Parse the notification type (using basic string matching to avoid jq dependency)
if echo "$input" | grep -q '"type"[[:space:]]*:[[:space:]]*"permission_prompt"'; then
    title="Claude Code"
    message="Permission requested"
elif echo "$input" | grep -q '"type"[[:space:]]*:[[:space:]]*"idle_prompt"'; then
    title="Claude Code"
    message="Task complete - waiting for input"
else
    # Unknown notification type, still notify
    title="Claude Code"
    message="Needs attention"
fi

# Send macOS notification with sound
osascript -e "display notification \"$message\" with title \"$title\" sound name \"Glass\""
