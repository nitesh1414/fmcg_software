; ===========================================================================
; RightServe — custom NSIS uninstaller hook
; ---------------------------------------------------------------------------
; WHY THIS EXISTS
; RightServe stores its database OUTSIDE the install dir, in the per-user
; app-data folder (Electron userData = %APPDATA%\RightServe\fmcg.db). A normal
; uninstall only removes the Program Files install dir, so the database was
; left behind — which is why a later reinstall showed the OLD data and let the
; user log in again, even after deleting the installation folder.
;
; At UNINSTALL time we ask whether to ALSO permanently delete all RightServe
; data on this computer.
;   - Default = No (keep data) for safety.
;   - During an automatic UPDATE (silent, ${isUpdated}) the prompt is skipped
;     and data is always preserved.
;
; NOTE: everything is done inside the single `customUnInstall` hook (prompt +
; deletion). We deliberately avoid a global NSIS Var, because a global variable
; that is only used by the uninstaller triggers "warning 6001: variable never
; set" during the INSTALLER compile pass — and electron-builder treats NSIS
; warnings as errors, which would fail the build.
; ===========================================================================

; ---------------------------------------------------------------------------
; Runs during uninstall, after the application files have been removed.
; ---------------------------------------------------------------------------
!macro customUnInstall
  ; Only ask on a real, user-initiated uninstall — never during an auto-update.
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
      "Do you also want to permanently DELETE all RightServe data on this computer?$\r$\n$\r$\nThis removes every invoice, item, party, payment, GST record, user and setting (the database stored in your AppData folder).$\r$\n$\r$\nChoose 'No' to keep your data so a future reinstall continues where you left off.$\r$\n$\r$\nWARNING: This cannot be undone. Make sure you have a backup first." \
      /SD IDNO IDYES sv_wipe_yes IDNO sv_wipe_no

    sv_wipe_yes:
      ; Electron always uses per-user app data; if this was a per-machine
      ; install make sure we target the CURRENT user's folders.
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}

      ; Roaming app data — this is where fmcg.db (the SQLite database) lives.
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      ; Electron uses the package.json "name" for cache / IndexedDB / GPUCache.
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
        RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
      !endif
      ; Local app data — caches, GPUCache, Code Cache, etc.
      RMDir /r "$LOCALAPPDATA\${APP_FILENAME}"

      ; Explicit fallbacks (product name "RightServe" + legacy folder names).
      RMDir /r "$APPDATA\RightServe"
      RMDir /r "$LOCALAPPDATA\RightServe"
      ; Legacy folders from the previous "StockVeda" branding, just in case.
      RMDir /r "$APPDATA\StockVeda"
      RMDir /r "$LOCALAPPDATA\StockVeda"
      RMDir /r "$APPDATA\fmcg-app"
      RMDir /r "$LOCALAPPDATA\fmcg-app"

      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}

      DetailPrint "All RightServe data has been deleted from this computer."
      Goto sv_wipe_done

    sv_wipe_no:
      DetailPrint "RightServe data kept in $APPDATA\${APP_FILENAME} (reinstall to continue using it)."

    sv_wipe_done:
  ${endIf}
!macroend
