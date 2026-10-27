import { SharePointStore, DATEI } from "../src/lib/sharepoint";

/** Minimales Graph-Imitat: eine Site, ein Laufwerk, Dateien per Pfad, eTags, If-Match, 403 auf Wunsch. */
export function fakeGraph(opt: { verboten?: boolean } = {}) {
  type Item = { id: string; name: string; pfad: string; inhalt: string; etag: number; ordner?: boolean; geaendert: string };
  const items = new Map<string, Item>();
  let n = 0;
  const neuesItem = (pfad: string, inhalt: string, ordner = false): Item => {
    const it: Item = { id: `i${++n}`, name: pfad.split("/").pop()!, pfad, inhalt, etag: 1, ordner, geaendert: new Date().toISOString() };
    items.set(pfad, it);
    return it;
  };
  const anfragen: string[] = [];
  /** wird vor dem nächsten PUT einmal ausgeführt (simuliert gleichzeitiges Speichern eines Kollegen) */
  let dazwischen: (() => void) | null = null;
  const antwort = (status: number, body?: unknown) => new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status });
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url).replace("https://graph.microsoft.com/v1.0", ""));
    const methode = init.method ?? "GET";
    anfragen.push(`${methode} ${u}`);
    const h = (init.headers ?? {}) as Record<string, string>;
    if (h.Authorization !== "Bearer TOKEN") return antwort(401);
    if (opt.verboten) return antwort(403, { error: { code: "accessDenied" } });
    const pfadM = u.match(/^\/drives\/DRIVE\/root:\/([^:?]+)(:\/(content|children))?/);
    const itemM = u.match(/^\/drives\/DRIVE\/items\/([^/?]+)(\/(content|children))?/);
    if (pfadM) {
      const pfad = pfadM[1];
      const teil = pfadM[3];
      if (teil === "content" && methode === "PUT") {
        if (dazwischen) {
          const d = dazwischen;
          dazwischen = null;
          d();
        }
        const vorh = items.get(pfad);
        if (u.includes("conflictBehavior=fail") && vorh) return antwort(409);
        if (h["If-Match"] && (!vorh || h["If-Match"] !== `"e${vorh.etag}"`)) return antwort(412);
        if (vorh) {
          vorh.inhalt = String(init.body);
          vorh.etag++;
          return antwort(200, { id: vorh.id });
        }
        return antwort(201, { id: neuesItem(pfad, String(init.body)).id });
      }
      if (teil === "children") {
        if (!items.has(pfad)) return antwort(404);
        const kinder = [...items.values()].filter((i) => i.pfad.startsWith(pfad + "/") && !i.pfad.slice(pfad.length + 1).includes("/"));
        return antwort(200, { value: kinder.map((i) => ({ id: i.id, name: i.name, lastModifiedDateTime: i.geaendert, ...(i.ordner ? { folder: {} } : { file: {} }) })) });
      }
      const it = items.get(pfad);
      return it ? antwort(200, { id: it.id, eTag: `"e${it.etag}"` }) : antwort(404);
    }
    if (itemM) {
      const it = [...items.values()].find((i) => i.id === itemM[1]);
      if (!it) return antwort(404);
      if (itemM[3] === "content") return antwort(200, it.inhalt);
      if (itemM[3] === "children" && methode === "POST") {
        const name = JSON.parse(String(init.body)).name;
        return antwort(201, { id: neuesItem(`${it.pfad}/${name}`, "", true).id });
      }
      if (methode === "PATCH") {
        const ziel = [...items.values()].find((i) => i.id === JSON.parse(String(init.body)).parentReference.id)!;
        items.delete(it.pfad);
        it.pfad = `${ziel.pfad}/${it.name}`;
        items.set(it.pfad, it);
        return antwort(200, { id: it.id });
      }
    }
    return antwort(400, { error: { message: `unerwartet: ${methode} ${u}` } });
  };
  return {
    fetch: fetch as typeof globalThis.fetch,
    items,
    anfragen,
    neuesItem,
    datei: () => JSON.parse(items.get(`Ordner/${DATEI}`)!.inhalt),
    setzeDazwischen: (f: () => void) => (dazwischen = f),
  };
}

export function store(g: ReturnType<typeof fakeGraph>, email = "p.preuss@claimm.de") {
  return new SharePointStore({
    token: async () => "TOKEN",
    konto: async () => ({ email, name: "Philipp" }),
    anmelden: async () => ({ email, name: "Philipp" }),
    abmelden: async () => {},
    fetch: g.fetch,
    laufwerk: "DRIVE",
    ordner: "/Ordner/",
  });
}

