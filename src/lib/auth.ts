/**
 * Anmeldung mit dem Microsoft-Firmenkonto (Entra ID) über MSAL im Popup-Fenster.
 * Die Authority ist auf den claim.m-Mandanten festgelegt: Private Microsoft-Konten und fremde Firmen kommen nicht durch.
 *
 * Entra → App-Registrierung → Authentifizierung → Plattform "Single-page application" mit den Umleitungs-URIs:
 *   https://praesi87.github.io/fristenradar/   (mit Schrägstrich am Ende, Entra vergleicht exakt)
 *   http://localhost:5173/                     (nur für npm run dev)
 */
import { PublicClientApplication, BrowserAuthError, InteractionRequiredAuthError, type AccountInfo } from "@azure/msal-browser";

/**
 * Zugriff auf SharePoint (Microsoft Graph). Delegierte Berechtigung: Die App darf nur, was die angemeldete Person
 * ohnehin darf. Laut Microsoft ohne Admin-Zustimmung möglich, sofern der Mandant Nutzern die Zustimmung erlaubt.
 * Ist das gesperrt, erscheint bei der Anmeldung „Administratorgenehmigung erforderlich“ – siehe HANDOVER.md.
 */
export const GRAPH_SCOPES = ["User.Read", "Sites.ReadWrite.All"];

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

function anmeldeFehler(e: unknown): Error {
  if (e instanceof BrowserAuthError) {
    if (e.errorCode === "user_cancelled")
      return new Error(
        "Anmeldung abgebrochen. Hat Microsoft „Administratorgenehmigung erforderlich“ angezeigt? Dann muss die IT der App einmalig zustimmen (Link für die IT: HANDOVER.md, Abschnitt 0). Bis dahin läuft nur die Demo: Adresse mit ?demo öffnen.",
      );
    if (e.errorCode === "popup_window_error" || e.errorCode === "empty_window_error")
      return new Error("Das Anmelde-Fenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben und erneut versuchen.");
  }
  const m = (e as Error)?.message ?? String(e);
  // AADSTS65001 = keine Zustimmung, AADSTS90094/90095 = Administratorgenehmigung erforderlich
  if (/AADSTS(65001|90094|90095)|admin(istrator)?.{0,20}(approval|consent)/i.test(m))
    return new Error(
      "Microsoft verlangt für den SharePoint-Zugriff eine Freigabe durch die IT (Administratorgenehmigung). Bitte die IT bitten, der App „Fristenradar“ die Berechtigung „Sites.ReadWrite.All (delegiert)“ zu erteilen – Details in HANDOVER.md, Abschnitt 0.",
    );
  return new Error(`Microsoft-Anmeldung fehlgeschlagen: ${m}`);
}

/** Anmeldung. Demo braucht nur User.Read, der SharePoint-Modus zusätzlich Sites.ReadWrite.All (eine Zustimmung beim ersten Mal). */
export async function anmeldenPopup(scopes: string[] = ["User.Read"]): Promise<Konto> {
  const app = await msal();
  try {
    const r = await app.loginPopup({ scopes, prompt: "select_account" });
    app.setActiveAccount(r.account);
    return alsKonto(r.account);
  } catch (e) {
    throw anmeldeFehler(e);
  }
}

/** Zugriffstoken für Microsoft Graph. Still aus dem Cache, sonst einmal per Popup (z. B. nach Ablauf der Sitzung). */
export async function graphToken(): Promise<string> {
  const app = await msal();
  const account = app.getActiveAccount() ?? app.getAllAccounts()[0];
  if (!account) throw new Error("Nicht angemeldet. Bitte neu anmelden.");
  try {
    return (await app.acquireTokenSilent({ scopes: GRAPH_SCOPES, account })).accessToken;
  } catch (e) {
    if (!(e instanceof InteractionRequiredAuthError)) throw anmeldeFehler(e);
    try {
      const r = await app.acquireTokenPopup({ scopes: GRAPH_SCOPES, account });
      return r.accessToken;
    } catch (e2) {
      throw anmeldeFehler(e2);
    }
  }
}

/** Meldet nur in dieser App ab (kein Abmelden aus dem Microsoft-Konto, damit Teams/Outlook angemeldet bleiben). */
export async function abmeldenLokal(): Promise<void> {
  const app = await msal();
  const a = app.getActiveAccount() ?? app.getAllAccounts()[0];
  app.setActiveAccount(null);
  if (a) await app.clearCache({ account: a });
}
