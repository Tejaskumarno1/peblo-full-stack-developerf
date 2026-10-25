; Extra rules for the Windows installer (electron-builder includes this file).
;
; One Peblo per computer. Running a Peblo installer when Peblo is already there never makes a second copy:
;   - an older Peblo is offered an update (same folder, settings and notes kept);
;   - the same version is offered a repair;
;   - a newer Peblo is left alone;
;   - a Peblo installed another way (Windows Installer / .msi) must be removed first, so two never exist.
; In silent mode (the app updating itself) the update just goes ahead.
!include "WordFunc.nsh"
!insertmacro VersionCompare

!macro customInit
  SetRegView 64

  ; A Windows Installer (.msi) copy of Peblo: refuse, and say how to remove it.
  StrCpy $R1 0
  pebloMsiLoop:
    EnumRegKey $R2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R1
    StrCmp $R2 "" pebloMsiDone
    IntOp $R1 $R1 + 1
    ReadRegStr $R3 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R2" "DisplayName"
    StrCmp $R3 "Peblo" 0 pebloMsiLoop
    ReadRegStr $R4 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R2" "UninstallString"
    StrCpy $R5 $R4 7
    StrCmp $R5 "MsiExec" 0 pebloMsiLoop
    MessageBox MB_OK|MB_ICONSTOP "Peblo is already installed on this computer in another form (Windows Installer).$\r$\n$\r$\nOnly one Peblo can be installed. Open Settings > Apps > Installed apps, remove Peblo, then run this installer again." /SD IDOK
    Abort
  pebloMsiDone:

  ; An existing Peblo from this installer.
  ReadRegStr $R6 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  StrCmp $R6 "" 0 pebloKnown
  ReadRegStr $R6 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  StrCmp $R6 "" pebloFresh pebloKnown
  pebloKnown:
    ${VersionCompare} "$R6" "${VERSION}" $R7
    ; $R7: 0 = same, 1 = installed is newer, 2 = installed is older
    StrCmp $R7 "1" pebloNewer
    StrCmp $R7 "0" pebloSame
    MessageBox MB_YESNO|MB_ICONQUESTION "Peblo $R6 is already installed.$\r$\n$\r$\nUpdate it to ${VERSION}? Your notes and settings are kept." /SD IDYES IDYES pebloFresh
    Abort
  pebloSame:
    MessageBox MB_YESNO|MB_ICONQUESTION "Peblo ${VERSION} is already installed on this computer, and there can only be one.$\r$\n$\r$\nRepair it by installing over the top?" /SD IDYES IDYES pebloFresh
    Abort
  pebloNewer:
    MessageBox MB_OK|MB_ICONINFORMATION "A newer Peblo ($R6) is already installed, so there is nothing to update." /SD IDOK
    Abort
  pebloFresh:
!macroend
