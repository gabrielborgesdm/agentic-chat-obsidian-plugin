import { describe, expect, it } from "vitest";
import { PathError, ensureMd, fold, normalizeVaultPath, numberedPath, parentFolder } from "../src/vault/paths";

describe("normalizeVaultPath", () => {
  it("normalises slashes and leading slash", () => {
    expect(normalizeVaultPath("\\Viagens\\Islândia.md")).toBe("Viagens/Islândia.md");
    expect(normalizeVaultPath("/a//b/./c.md")).toBe("a/b/c.md");
  });
  it.each(["../x.md", "a/../../x.md", "a/..", "C:\\Windows\\x.md", "c:/x", ".obsidian/app.json", "a/.hidden/x.md", "", "   ", "a/b|c.md"])(
    "rejects %j",
    (p) => {
      expect(() => normalizeVaultPath(p)).toThrow(PathError);
    }
  );
  it("rejects non-strings", () => {
    expect(() => normalizeVaultPath(42)).toThrow(PathError);
    expect(() => normalizeVaultPath(undefined)).toThrow(PathError);
  });
  it("allows empty for root when asked", () => {
    expect(normalizeVaultPath("", { allowEmpty: true })).toBe("");
    expect(normalizeVaultPath("/", { allowEmpty: true })).toBe("");
  });
});

describe("helpers", () => {
  it("ensureMd", () => {
    expect(ensureMd("a/b")).toBe("a/b.md");
    expect(ensureMd("a/b.md")).toBe("a/b.md");
    expect(ensureMd("a/img.png")).toBe("a/img.png");
  });
  it("numberedPath", () => {
    expect(numberedPath("a/b.md", 1)).toBe("a/b (1).md");
    expect(numberedPath("a/b", 2)).toBe("a/b (2)");
  });
  it("parentFolder", () => {
    expect(parentFolder("a/b/c.md")).toBe("a/b");
    expect(parentFolder("c.md")).toBe("");
  });
  it("fold strips accents", () => {
    expect(fold("Saúde Ação")).toBe("saude acao");
  });
});
