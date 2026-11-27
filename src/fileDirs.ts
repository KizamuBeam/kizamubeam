// Startverzeichnisse für Öffnen/Speichern: Sitzung zuerst, dann eingestellter
// Standardordner, dann der OS-Standard. Mit Opt-in („immer Defaults“) gewinnt
// immer die Einstellung, soweit gesetzt.
export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (i < 0) return '';
  // Dateiname direkt im Stamm: „/a.kzb“ → „/“
  if (i === 0) return path[0] === '/' ? '/' : '';
  // Windows-Laufwerkstamm: „C:\a.kzb“ → „C:\“ (nicht „C:“, das wäre das Arbeitsverzeichnis des Laufwerks)
  if (i === 2 && path[1] === ':' && (path[2] === '\\' || path[2] === '/')) return path.slice(0, 3);
  return path.slice(0, i);
}

/** Startverzeichnis auflösen: Opt-in → Default; sonst Sitzung, sonst Default, sonst OS-Standard (null). */
export function resolveStartDir(alwaysDefaults: boolean, def: string, session: string | null): string | null {
  const d = def.trim();
  if (alwaysDefaults) return d ? d : null;
  if (session) return session;
  return d ? d : null;
}
