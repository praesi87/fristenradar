import { useState } from "react";
import type { Store } from "../lib/store";
import { Logo } from "./gemeinsam";

export function Login({ store, onAngemeldet }: { store: Store; onAngemeldet: () => void }) {
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  // Fehler, die Supabase nach der Microsoft-Weiterleitung in der Adresse zurückgibt (z. B. Registrierung gesperrt)
  const [fehler, setFehler] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search);
    const f = p.get("error_description");
    if (!f) return null;
    if (/signups not allowed/i.test(f)) return "Microsoft-Anmeldung abgelehnt: In Supabase ist „Allow new users to sign up“ ausgeschaltet. Für den Microsoft-Login muss es AN sein (siehe HANDOVER.md, Abschnitt Microsoft-Login).";
    if (/email/i.test(f) && /(missing|not found|empty)/i.test(f)) return "Microsoft hat keine E-Mail-Adresse übermittelt. In der Entra-App unter „Token configuration“ den optionalen Claim „email“ hinzufügen (siehe HANDOVER.md).";
    return `Microsoft-Anmeldung fehlgeschlagen: ${f}`;
  });
  const [laeuft, setLaeuft] = useState(false);
  const [mitPasswort, setMitPasswort] = useState(false);

  async function microsoft() {
    setLaeuft(true);
    setFehler(null);
    try {
      await store.anmeldenMicrosoft();
      onAngemeldet();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      // bei Supabase folgt die Weiterleitung, die Seite wird dann ohnehin neu geladen
      setLaeuft(false);
    }
  }

  async function anmelden(e: React.FormEvent) {
    e.preventDefault();
    setLaeuft(true);
    setFehler(null);
    try {
      await store.anmelden(email.trim(), passwort);
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className="login">
      <div className="login-box">
        <Logo variante="dunkel" />
        <h1>Fristenradar Rhein-Main</h1>
        <p className="login-unter">Bitte mit Firmen-Account anmelden</p>
        <button className="knopf knopf-microsoft" onClick={microsoft} disabled={laeuft}>
          <svg viewBox="0 0 21 21" width="20" height="20" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          {laeuft && !mitPasswort ? "Anmeldefenster geöffnet …" : "Mit Microsoft anmelden"}
        </button>
        {fehler && <div className="meldung meldung-fehler">{fehler}</div>}
        {store.modus === "supabase" &&
          (!mitPasswort ? (
            <button className="link" onClick={() => setMitPasswort(true)}>
              Anmeldung mit E-Mail und Passwort (für Externe)
            </button>
          ) : (
            <form className="login-passwort" onSubmit={anmelden}>
              <label className="feld">
                <span>E-Mail</span>
                <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="feld">
                <span>Passwort</span>
                <input type="password" autoComplete="current-password" required value={passwort} onChange={(e) => setPasswort(e.target.value)} />
              </label>
              <button className="knopf knopf-zweit" disabled={laeuft}>
                {laeuft ? "Prüft …" : "Mit Passwort anmelden"}
              </button>
              <small>Nur für einzeln freigeschaltete Zugänge, die der Admin in Supabase anlegt.</small>
            </form>
          ))}
      </div>
    </div>
  );
}
