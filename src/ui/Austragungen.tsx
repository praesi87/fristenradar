import { useState } from "react";
import { useApp } from "./kontext";
import { istAusgetragen } from "../lib/brief";

export function AustragungenSeite() {
  const { austragungen, store, neuLaden, melde, objekte } = useApp();
  const [name, setName] = useState("");
  const [notiz, setNotiz] = useState("");

  async function anlegen() {
    if (!name.trim()) return;
    try {
      await store.austragungAnlegen(name.trim(), notiz.trim());
      setName("");
      setNotiz("");
      await neuLaden();
      melde("Eingetragen. Für diesen Bauherrn werden keine Briefe mehr erzeugt.");
    } catch (e) {
      melde((e as Error).message, "fehler");
    }
  }

  return (
    <section>
      <div className="seitenkopf">
        <div>
          <div className="eyebrow">§ 7 UWG · Widerspruch</div>
          <h1>Austragungen</h1>
          <p className="unterzeile">Wer keine Post mehr möchte, kommt hier hinein. Für passende Bauherren sperrt die App den Brief. Einträge sind dauerhaft (Entfernen nur durch Admin per SQL).</p>
        </div>
      </div>
      <div className="kasten">
        <div className="felder">
          <label className="feld">
            <span>Organisation / Name (wie im Feld „Bauherr“)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="feld">
            <span>Notiz (Datum, Kanal des Widerspruchs)</span>
            <input value={notiz} onChange={(e) => setNotiz(e.target.value)} />
          </label>
        </div>
        <button className="knopf" disabled={!name.trim()} onClick={anlegen}>
          Austragen
        </button>
      </div>
      <div className="tabelle-rahmen">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Name</th>
              <th>Notiz</th>
              <th>Betroffene Einträge</th>
              <th>Eingetragen</th>
            </tr>
          </thead>
          <tbody>
            {austragungen.map((a) => {
              const betroffen = objekte.filter((o) => istAusgetragen(o.bauherr, [a]));
              return (
                <tr key={a.id}>
                  <td>
                    <b>{a.name}</b>
                  </td>
                  <td>{a.notiz}</td>
                  <td>
                    {betroffen.length === 0
                      ? "–"
                      : betroffen.map((o) => (
                          <a key={o.id} href={`#/objekt/${o.id}`} className="chip">
                            #{o.id} {o.projekt.slice(0, 30)}
                          </a>
                        ))}
                  </td>
                  <td className="sub">
                    {new Date(a.erstellt_am).toLocaleDateString("de-DE")} · {a.erstellt_von}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {austragungen.length === 0 && <div className="leer">Keine Austragungen.</div>}
      </div>
    </section>
  );
}
