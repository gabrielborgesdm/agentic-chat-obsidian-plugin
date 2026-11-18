import { describe, expect, it } from "vitest";
import { pickContextNotes, projectFolder } from "../src/vault/projectContext";

const T = "Viagens/2026-11-travel";
const trip = [
  { path: `${T}/checklist.md`, size: 19456 },
  { path: `${T}/index.md`, size: 10218 },
  { path: `${T}/passeios.md`, size: 20244 },
  { path: `${T}/roteiro.md`, size: 30331 },
  { path: `${T}/voos.md`, size: 2367 },
];
const notesIn = (f: string) => (f === T ? trip.map((n) => ({ ...n })) : []);
const sizeOf = (p: string) => trip.find((n) => n.path === p)?.size ?? 1000;

describe("projectFolder", () => {
  it("finds the folder shared by several top hits, anywhere in the vault", () => {
    expect(projectFolder([{ path: `${T}/index.md`, score: 9 }, { path: "Casa/lista.md", score: 8 }, { path: `${T}/passeios.md`, score: 7 }])).toBe(T);
    expect(projectFolder([{ path: "Estudo/Backend/java.md", score: 5 }, { path: "Estudo/Backend/spring.md", score: 4 }])).toBe("Estudo/Backend");
  });
  it("returns null when hits are spread out or at the root", () => {
    expect(projectFolder([{ path: "a/x.md", score: 3 }, { path: "b/y.md", score: 2 }])).toBeNull();
    expect(projectFolder([{ path: "x.md", score: 3 }, { path: "y.md", score: 2 }])).toBeNull();
  });
});

describe("pickContextNotes", () => {
  const hits = [
    { path: `${T}/index.md`, score: 9 },
    { path: `${T}/passeios.md`, score: 8 },
    { path: "Pessoal/ideias.md", score: 2 },
  ];
  it("includes the whole project folder, best hits first, when it fits", () => {
    const r = pickContextNotes(hits, notesIn, sizeOf, 100_000);
    expect(r.project).toBe(T);
    expect(r.paths.slice(0, 2)).toEqual([`${T}/index.md`, `${T}/passeios.md`]);
    expect(r.paths).toContain(`${T}/roteiro.md`);
    expect(r.paths).toContain("Pessoal/ideias.md"); // other hits after the project
    expect(r.left).toEqual([]);
  });
  it("keeps the most relevant notes and lists the rest when space is short", () => {
    const r = pickContextNotes(hits, notesIn, sizeOf, 32_000);
    expect(r.paths.slice(0, 2)).toEqual([`${T}/index.md`, `${T}/passeios.md`]);
    expect(r.paths).not.toContain(`${T}/roteiro.md`);
    expect(r.left).toContain(`${T}/roteiro.md`);
  });
  it("uses the best hits when there is no shared folder", () => {
    const r = pickContextNotes([{ path: "a/x.md", score: 3 }, { path: "b/y.md", score: 2 }], notesIn, () => 500, 10_000);
    expect(r).toEqual({ paths: ["a/x.md", "b/y.md"], project: null, left: [] });
  });
  it("includes nothing for a tiny budget", () => {
    expect(pickContextNotes(hits, notesIn, sizeOf, 300).paths).toEqual([]);
  });
});

describe("pickContextNotes with a small budget", () => {
  it("always includes the most relevant note even when it is bigger than the budget", () => {
    const r = pickContextNotes([{ path: `${T}/passeios.md`, score: 9 }, { path: `${T}/voos.md`, score: 5 }], notesIn, sizeOf, 9_600);
    expect(r.paths).toEqual([`${T}/voos.md`, `${T}/passeios.md`]); // the big top note goes last
    expect(r.left).toContain(`${T}/roteiro.md`);
  });
});

describe("project from the best hit's folder", () => {
  it("includes the trip folder when only its index.md ranked first (the real chat)", () => {
    const r = pickContextNotes(
      [{ path: `${T}/index.md`, score: 9 }, { path: "Dinheiro/Contabilidade.md", score: 3 }, { path: "Trabalho/Entrevistas.md", score: 2 }],
      notesIn,
      sizeOf,
      100_000
    );
    expect(r.project).toBe(T);
    expect(r.paths).toContain(`${T}/passeios.md`);
    expect(r.paths).toContain(`${T}/roteiro.md`);
  });
});

describe("search hits before the rest of the project", () => {
  it("includes a small, relevant note from another folder before the project's other notes", () => {
    const r = pickContextNotes(
      [{ path: `${T}/checklist.md`, score: 9 }, { path: "Pessoal/Senhas.md", score: 8 }],
      notesIn,
      (p) => (p === "Pessoal/Senhas.md" ? 120 : sizeOf(p)),
      9_600
    );
    expect(r.paths[0]).toBe("Pessoal/Senhas.md"); // fits, so it comes before the oversized top note
    expect(r.paths).toContain("Pessoal/Senhas.md");
  });
});
