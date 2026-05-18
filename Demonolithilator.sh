#!/bin/bash

# 1. Create a timestamped backup of the monolith
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
cp ui/script.js ui/script_backup_$TIMESTAMP.js
echo "[SYSTEM] Backup created: ui/script_backup_$TIMESTAMP.js"

# 2. Prepare the modular directory and clear old files
mkdir -p ui/js
rm -f ui/js/*.js

# 3. The Awk Router
awk '
BEGIN {
    dest = "ui/js/globals.js"
    braces = 0
    in_func = 0
}

# When we hit a function, check its name and route to the correct file
/^(async )?function / {
    if ($0 ~ /(loadTree|updateBreadcrumbs|goBack|goForward|goUp|openFile|createTabUI|refreshTabVisuals|switchTab|closeTab|saveFile|renameItem|deleteItem|createNewFile|createNewFolder|runGlobalSearch)/) {
        dest = "ui/js/filesystem.js"
    } else if ($0 ~ /(refreshGitStatus|createGitItem|gitAction|createBranch|mergeBranch|initGitRepo|commitChanges)/) {
        dest = "ui/js/git.js"
    } else if ($0 ~ /(askAI|runShadowTest|validateWebCode|runAutomatedTests|startIndexing|applyDiffMerge)/) {
        dest = "ui/js/ai_core.js"
    } else if ($0 ~ /(updateSystemStatus|shutdownCrucible|switchSidebar|toggleCustomThemeEditor|populateThemeDropdown|saveCustomThemeToDisk|applySettings|loadSettings|saveSettings|openSettings|closeSettings|switchSettingsTab)/) {
        dest = "ui/js/settings.js"
    } else if ($0 ~ /(initResizers|toggleAutoFormat|triggerManualFormat|toggleSplitView|toggleTerminal|toggleWrap|togglePreview|setViewport|togglePreviewBackground|renderPreview)/) {
        dest = "ui/js/editor.js"
    } else {
        # Fallback for saveWorkspaceState / restoreWorkspaceState
        dest = "ui/js/globals.js"
    }
    in_func = 1
}

# Print the current line to the assigned destination file
{
    print $0 >> dest

    # Count opening and closing braces on this line
    braces += gsub(/\{/, "{") - gsub(/\}/, "}")

    # If we hit 0 braces and we are inside a function, the block is done. Reset to globals.
    if (in_func && braces == 0) {
        in_func = 0
        dest = "ui/js/globals.js"
    }
}
' ui/script.js

echo "[SUCCESS] Monolith shattered. Files sorted into ui/js/"
