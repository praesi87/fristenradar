/**
 * Anmeldung mit dem Microsoft-Firmenkonto (Entra ID) über MSAL im Popup-Fenster.
 * Die Authority ist auf den claim.m-Mandanten festgelegt: Private Microsoft-Konten und fremde Firmen kommen nicht durch.
 *
 * Entra → App-Registrierung → Authentifizierung → Plattform "Single-page application" mit den Umleitungs-URIs:
 *   https://praesi87.github.io/fristenradar/   (mit Schrägstrich am Ende, Entra vergleicht exakt)
 *   http://localhost:5173/                     (nur für npm run dev)
 */
import { PublicClientApplication, BrowserAuthError, type AccountInfo } from "@azure/msal-browser";

const CLIENT_ID = "fbb2c372-0be9-42a0-889d-a821a7ced2e4";
const TENANT_ID = "07cf9a53-cac1-46a9-9f4a-e9075df36c17";

export interface Konto {
  name: string;
  email: string;
}

let instanz: Promise<PublicClientApplication> | null = null;

function msal(): Promise<PublicClientApplication> {
  instanz ??= (async () => {
    const app = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        // Hash-Routing der App: nur Adresse ohne # und ?
        redirectUri: `${window.location.origin}${window.location.pathname}`,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    await app.initialize();
    return app;
  })();
  return instanz;
}

function alsKonto(a: AccountInfo): Konto {
  return { name: a.name || a.username.split("@")[0], email: a.username.toLowerCase() };
}

/** Läuft dieses Fenster gerade als Rücksprung-Seite eines MSAL-Popups? Dann darf die App nicht starten (sie würde den # überschreiben). */
export function istAnmeldePopup(): boolean {
  return window.opener != null && window.opener !== window && /[#&](code|error)=/.test(window.location.hash);
}

/** Bereits angemeldetes Konto dieser Browser-Sitzung, sonst null. */
export async function aktuellesKonto(): Promise<Konto | null> {
  const app = await msal();
  const a = app.getActiveAccount() ?? app.getAllAccounts()[0];
  return a ? alsKonto(a) : null;
}

export async function anmeldenPopup(): Promise<Konto> {
  const app = await msal();
  try {
    const r = await app.loginPopup({ scopes: ["User.Read"], prompt: "select_account" });
    app.setActiveAccount(r.account);
    return alsKonto(r.account);
  } catch (e) {
    if (e instanceof BrowserAuthError) {
      if (e.errorCode === "user_cancelled") throw new Error("Anmeldung abgebrochen.");
      if (e.errorCode === "popup_window_error" || e.errorCode === "empty_window_error")
        throw new Error("Das Anmelde-Fenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben und erneut versuchen.");
    }
    throw new Error(`Microsoft-Anmeldung fehlgeschlagen: ${(e as Error).message}`);
  }
}

/** Meldet nur in dieser App ab (kein Abmelden aus dem Microsoft-Konto, damit Teams/Outlook angemeldet bleiben). */
export async function abmeldenLokal(): Promise<void> {
  const app = await msal();
  const a = app.getActiveAccount() ?? app.getAllAccounts()[0];
  app.setActiveAccount(null);
  if (a) await app.clearCache({ account: a });
}
