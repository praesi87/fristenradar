import { Component, type ReactNode } from "react";

/** Fängt Abstürze der Oberfläche ab: Meldung + „Neu laden“ statt leerer Seite. */
export class Fehlergrenze extends Component<{ children: ReactNode }, { fehler: Error | null }> {
  state = { fehler: null as Error | null };
  static getDerivedStateFromError(fehler: Error) {
    return { fehler };
  }
  componentDidCatch(fehler: Error) {
    console.error("[Fristenradar] Absturz der Oberfläche:", fehler);
  }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div className="haupt">
        <div className="kasten kasten-fehler">
          <h2>Da ist etwas schiefgelaufen</h2>
          <p>Die Seite konnte nicht angezeigt werden. Gespeicherte Daten sind davon nicht betroffen.</p>
          <pre>{this.state.fehler.message}</pre>
          <button className="knopf" onClick={() => window.location.reload()}>
            Neu laden
          </button>
        </div>
      </div>
    );
  }
}
