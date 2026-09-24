import { useState } from "react";
import type { Store } from "../lib/store";
import { Logo } from "./gemeinsam";

export function Login({ store }: { store: Store }) {
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

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
      <div className="login-seite">
        <Logo variante="dunkel" />
        <div>
          <div className="eyebrow eyebrow-hell">Qualität &amp; Bau · Gewährleistung</div>
          <h1>Fristenradar Rhein-Main</h1>
          <p>Gewährleistungsfristen im Blick – Register für eigene Mandate, Marktradar für die Akquise.</p>
        </div>
        <small>Verträge im Griff, Projekte auf Kurs.</small>
      </div>
      <form className="login-form" onSubmit={anmelden}>
        <h2>Anmelden</h2>
        <label className="feld">
          <span>E-Mail</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="feld">
          <span>Passwort</span>
          <input type="password" autoComplete="current-password" required value={passwort} onChange={(e) => setPasswort(e.target.value)} />
        </label>
        {fehler && <div className="meldung meldung-fehler">{fehler}</div>}
        <button className="knopf" disabled={laeuft}>
          {laeuft ? "Prüft …" : "Anmelden"}
        </button>
        <small>Zugänge vergibt der Admin in Supabase. Keine Selbstregistrierung.</small>
      </form>
    </div>
  );
}
