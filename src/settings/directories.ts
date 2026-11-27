// Standardordner für Öffnen/Speichern plus Opt-in „immer verwenden“.
// Die Werte liegen bei den Dateifunktionen (src/files.ts); das Fenster arbeitet nur auf dem Entwurf.
import { h } from '../dom';
import { t } from '../i18n';
import { isTauri } from '../machine';
import { loadAlwaysDefaultDirs, loadDefaultOpenDir, loadDefaultSaveDir, saveAlwaysDefaultDirs, saveDefaultOpenDir, saveDefaultSaveDir } from '../files';
import { registerSettingsSection, type SettingsDraftContext, type SettingsField } from './registry';

const desktopOnly = () => isTauri();

function browseRow(context: SettingsDraftContext, id: string): HTMLElement {
  const btn = h('button', {
    type: 'button', class: 'btn small',
    onclick: async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const picked = await invoke<string | null>('sync_pick_folder').catch(() => null);
      if (picked) context.update(new Map([[id, picked]]));
    },
  }, t('Durchsuchen …'));
  return h('div', { class: 'settings-dir-browse' }, btn);
}

export function directorySettingsFields(): SettingsField[] {
  return [
    {
      kind: 'text', id: 'files.defaultOpenDir', group: t('Standardordner'), label: t('Standardordner zum Öffnen'),
      keywords: 'Ordner Verzeichnis Startordner Öffnen Dialog Standardordner folder directory open default',
      hint: t('Startordner des Öffnen-Dialogs. Gilt, bis in dieser Sitzung ein anderer Ordner benutzt wurde — oder immer, wenn „Standardordner immer verwenden“ an ist.'),
      when: desktopOnly, def: '',
      get: loadDefaultOpenDir, set: (v) => saveDefaultOpenDir(v),
    },
    {
      kind: 'custom', id: 'files.defaultOpenDirBrowse', group: t('Standardordner'), label: t('Ordner wählen'),
      when: desktopOnly,
      render: (context) => browseRow(context, 'files.defaultOpenDir'),
    },
    {
      kind: 'text', id: 'files.defaultSaveDir', group: t('Standardordner'), label: t('Standardordner zum Speichern'),
      keywords: 'Ordner Verzeichnis Startordner Speichern Dialog Standardordner folder directory save default',
      hint: t('Startordner des Speichern-Dialogs („Speichern unter“). Gilt, bis in dieser Sitzung ein anderer Ordner benutzt wurde — oder immer, wenn „Standardordner immer verwenden“ an ist.'),
      when: desktopOnly, def: '',
      get: loadDefaultSaveDir, set: (v) => saveDefaultSaveDir(v),
    },
    {
      kind: 'custom', id: 'files.defaultSaveDirBrowse', group: t('Standardordner'), label: t('Ordner wählen'),
      when: desktopOnly,
      render: (context) => browseRow(context, 'files.defaultSaveDir'),
    },
    {
      kind: 'toggle', id: 'files.alwaysDefaultDirs', group: t('Standardordner'), label: t('Standardordner immer verwenden'), def: false,
      keywords: 'Ordner Standard immer Dialog Öffnen Speichern Standardordner folder always default',
      hint: t('Öffnen- und Speichern-Dialog starten immer in den Standardordnern — auch wenn in dieser Sitzung schon andere Ordner benutzt wurden. Aus: Die Sitzung merkt sich benutzte Ordner; die Standards gelten nur, bis erstmals ein anderer Ordner gewählt wurde.'),
      when: desktopOnly,
      get: loadAlwaysDefaultDirs, set: (v) => saveAlwaysDefaultDirs(v),
    },
  ];
}

/** Abschnitt „Dateien“ im Einstellungsfenster (zwischen Allgemein und Darstellung). */
export function registerDirectorySettings() {
  registerSettingsSection({
    id: 'files',
    title: t('Dateien'),
    order: 15,
    note: t('Startordner für die Dateidialoge. Nur in der Desktop-App — im Browser bestimmt das System den Ordner.'),
    fields: directorySettingsFields(),
  });
}
