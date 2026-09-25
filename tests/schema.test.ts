/**
 * Prüft supabase/schema.sql in einem echten PostgreSQL (PGlite, läuft im Test-Prozess).
 * Supabase-Eigenheiten (Schema "auth", Rollen anon/authenticated) werden nachgebildet –
 * so wie Supabase auth.jwt() definiert: aus der Session-Variable request.jwt.claims.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf-8");
let db: PGlite;

async function als(rolle: "anon" | "authenticated" | "postgres", email: string | null, sql: string, params: unknown[] = [], provider = "email") {
  const claims = email ? JSON.stringify({ email, app_metadata: { provider, providers: [provider] } }) : "";
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false);`);
  if (rolle !== "postgres") await db.exec(`set role ${rolle};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    -- Supabase vergibt standardmäßig breite Rechte auf public – das Schema muss sie wieder einschränken
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(schema);
  await db.exec(schema); // idempotent?
  await db.exec(`insert into public.erlaubte_nutzer (email) values ('philipp@test.invalid');`);
  await db.exec(`insert into public.erlaubte_domains (domain) values ('firma.invalid');`);
}, 60000);

describe("schema.sql", () => {
  it("anonym: keine Daten, aber ping() geht", async () => {
    await expect(als("anon", null, "select * from public.objekte")).rejects.toThrow(/permission denied/);
    const r = await als("anon", null, "select public.ping() as p");
    expect(r.rows[0]).toEqual({ p: "ok" });
  });

  it("angemeldet, aber nicht freigeschaltet: sieht nichts, darf nichts anlegen", async () => {
    await als("postgres", null, "insert into public.objekte (spur, projekt, quelle) values ('B', 'Vorhanden', 'q')");
    const r = await als("authenticated", "fremd@test.invalid", "select * from public.objekte");
    expect(r.rows.length).toBe(0);
    await expect(als("authenticated", "fremd@test.invalid", "insert into public.objekte (spur, projekt, quelle) values ('B','X','q')")).rejects.toThrow(/row-level security/);
    const f = await als("authenticated", "fremd@test.invalid", "select public.ist_freigeschaltet() as f");
    expect(f.rows[0]).toEqual({ f: false });
  });

  it("freigeschaltet: anlegen, ändern, Historie, Stempel", async () => {
    const neu = await als("authenticated", "Philipp@Test.invalid", "insert into public.objekte (spur, projekt, quelle, ort) values ('B','Testobjekt','https://q','Mainz') returning id, erstellt_von");
    const id = (neu.rows[0] as { id: number }).id;
    expect((neu.rows[0] as { erstellt_von: string }).erstellt_von).toBe("Philipp@Test.invalid");
    await als("authenticated", "philipp@test.invalid", "update public.objekte set status = 'angeschrieben', spur = 'A', erstellt_von = 'hack' where id = $1", [id]);
    const o = await als("authenticated", "philipp@test.invalid", "select spur, status, erstellt_von, geaendert_von from public.objekte where id = $1", [id]);
    expect(o.rows[0]).toEqual({ spur: "B", status: "angeschrieben", erstellt_von: "Philipp@Test.invalid", geaendert_von: "philipp@test.invalid" });
    const h = await als("authenticated", "philipp@test.invalid", "select aktion, nutzer, aenderungen from public.historie where objekt_id = $1 order by id", [id]);
    expect(h.rows.map((r) => (r as { aktion: string }).aktion)).toEqual(["angelegt", "geaendert"]);
    const diff = (h.rows[1] as { aenderungen: Record<string, unknown> }).aenderungen;
    expect(Object.keys(diff)).toEqual(["status"]);
  });

  it("Löschen und Historie-Manipulation sind gesperrt", async () => {
    await expect(als("authenticated", "philipp@test.invalid", "delete from public.objekte")).rejects.toThrow(/permission denied/);
    await expect(als("authenticated", "philipp@test.invalid", "delete from public.historie")).rejects.toThrow(/permission denied/);
    await expect(als("authenticated", "philipp@test.invalid", "update public.historie set nutzer = 'x'")).rejects.toThrow(/permission denied/);
    await expect(als("authenticated", "philipp@test.invalid", "select * from public.erlaubte_nutzer")).rejects.toThrow(/permission denied/);
    await expect(als("authenticated", "philipp@test.invalid", "insert into public.erlaubte_nutzer values ('ich@test.invalid')")).rejects.toThrow();
  });

  it("Fachregeln als Constraints", async () => {
    await expect(als("authenticated", "philipp@test.invalid", "insert into public.objekte (spur, projekt) values ('B','ohne Quelle')")).rejects.toThrow(/quelle_spur_b/);
    await expect(als("authenticated", "philipp@test.invalid", "insert into public.objekte (spur, projekt, quelle, bezugsart) values ('B','x','q','abnahme')")).rejects.toThrow(/abnahme_nur_spur_a/);
    await expect(als("authenticated", "philipp@test.invalid", "insert into public.objekte (spur, projekt, datum) values ('A','x','Frühjahr 2023')")).rejects.toThrow(/datum/);
    await expect(als("authenticated", "philipp@test.invalid", "insert into public.objekte (spur, projekt, datum, bezugsart) values ('A','x','2024-03-12','abnahme')")).resolves.toBeTruthy();
  });

  it("Domain-Freischaltung nur mit Microsoft-Login und nur exakt diese Domain", async () => {
    const q = "select public.ist_freigeschaltet() as f";
    expect((await als("authenticated", "Anna.Test@Firma.invalid", q, [], "azure")).rows[0]).toEqual({ f: true });
    expect((await als("authenticated", "anna@firma.invalid", q, [], "email")).rows[0]).toEqual({ f: false });
    expect((await als("authenticated", "anna@evil.firma.invalid", q, [], "azure")).rows[0]).toEqual({ f: false });
    expect((await als("authenticated", "anna@firma.invalid.evil", q, [], "azure")).rows[0]).toEqual({ f: false });
    const r = await als("authenticated", "anna@firma.invalid", "select count(*)::int as n from public.objekte", [], "azure");
    expect((r.rows[0] as { n: number }).n).toBeGreaterThan(0);
    await expect(als("authenticated", "anna@firma.invalid", "insert into public.erlaubte_domains values ('x.invalid')", [], "azure")).rejects.toThrow(/permission denied/);
  });

  it("Austragungen und Einstellungen", async () => {
    await als("authenticated", "philipp@test.invalid", "insert into public.austragungen (name) values ('Muster GmbH')");
    await expect(als("authenticated", "philipp@test.invalid", "delete from public.austragungen")).rejects.toThrow(/permission denied/);
    await als("authenticated", "philipp@test.invalid", `insert into public.einstellungen (schluessel, wert) values ('buero', '{"lat":50.1,"lon":8.6,"adresse":"x"}') on conflict (schluessel) do update set wert = excluded.wert`);
    const e = await als("authenticated", "philipp@test.invalid", "select wert from public.einstellungen where schluessel = 'buero'");
    expect((e.rows[0] as { wert: { lat: number } }).wert.lat).toBe(50.1);
    const fremd = await als("authenticated", "fremd@test.invalid", "select * from public.einstellungen");
    expect(fremd.rows.length).toBe(0);
  });
});
