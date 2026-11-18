import { describe, expect, it } from "vitest";
import { expandTaskEmbeds, linkTaskLines, splitTaskText, type TaskRef } from "../src/ui/taskLinks";

const P = "Viagens/2026-11-travel/checklist.md";
const tasks: TaskRef[] = [
  { path: P, line: 29, done: false, text: "St Christopher's, Edimburgo: check-in online antes da chegada, pelo link do e-mail de confirmação. [[hospedagem#Edimburgo]] ⏰ 25/11 18:00 IS" },
  { path: P, line: 30, done: false, text: "St Christopher's, Edimburgo: pedir quarto longe do bar e perguntar pela mala no dia 28." },
  { path: P, line: 32, done: true, text: "Guinness Storehouse, 05/12: ver preço e horário no site, escolher o horário e comprar." },
  { path: "Viagens/2026-11-travel/remedios.md", line: 5, done: false, text: "Conferir a receita atual de cada medicamento" },
];

describe("linkTaskLines", () => {
  it("turns the raw 'path: line text' answer from the real chat into linked checkboxes grouped by note", () => {
    const answer = [
      "Olha nas suas notas de viagem, aqui estão todos os checklists:",
      `${P}: 29 St Christopher's, Edimburgo: check-in online antes da chegada, pelo link do e-mail de confirmação. [[hospedagem#Edimburgo]] ⏰ 25/11 18:00 IS`,
      `${P}: 30 St Christopher's, Edimburgo: pedir quarto longe do bar e perguntar pela mala no dia 28. O pouso é às 13:00…`,
      `${P}: 32 Guinness Storehouse, 05/12: ver preço e horário no site`,
    ].join("\n");
    const r = linkTaskLines(answer, tasks)!;
    expect(r.refs.map((t) => t?.line)).toEqual([29, 30, 32]);
    expect(r.markdown).toContain("**[[Viagens/2026-11-travel/checklist.md|checklist]]**");
    expect(r.markdown).toContain("- [ ] St Christopher's, Edimburgo: pedir quarto longe do bar e perguntar pela mala no dia 28.");
    expect(r.markdown).toContain("- [x] Guinness Storehouse"); // real state from the note
    expect(r.markdown.startsWith("Olha nas suas notas")).toBe(true);
  });

  it("links '- [ ] text' lines by their (possibly shortened) text and leaves unknown ones unlinked", () => {
    const answer = "- [ ] Conferir a receita atual de cada medicamento\n- [ ] Comprar um guarda-chuva novo\n- [ ] St Christopher's, Edimburgo: pedir quarto longe…";
    const r = linkTaskLines(answer, tasks)!;
    expect(r.refs.map((t) => t && `${t.path}:${t.line}`)).toEqual(["Viagens/2026-11-travel/remedios.md:5", null, `${P}:30`]);
  });

  it("does not guess when a short text matches several tasks", () => {
    expect(linkTaskLines("- [ ] St Christopher's, Edimburgo", tasks)).toBeNull();
  });

  it("returns null for answers without tasks", () => {
    expect(linkTaskLines("Sua viagem é de 20/11 a 11/12.", tasks)).toBeNull();
  });
});

describe("/tasks output", () => {
  it("becomes linked checkboxes", () => {
    const r = linkTaskLines(`${P}:29 [ ] ${tasks[0].text}\n${P}:32 [x] ${tasks[2].text}`, tasks)!;
    expect(r.refs.map((t) => t?.line)).toEqual([29, 32]);
    expect(r.markdown).toContain("- [x] Guinness");
  });
});

describe("{{tasks: path}} references", () => {
  it("expands a note reference into its open tasks, which then link to checkboxes", () => {
    const answer = `Aqui estão as tarefas da viagem:\n{{tasks: ${P}}}`;
    const expanded = expandTaskEmbeds(answer, tasks);
    const r = linkTaskLines(expanded, tasks)!;
    expect(r.refs.map((t) => t?.line)).toEqual([29, 30]); // 32 is done: only open tasks by default
    expect(r.markdown.startsWith("Aqui estão as tarefas da viagem:")).toBe(true);
  });
  it("supports '| all', folders and [[links]]", () => {
    expect(expandTaskEmbeds(`{{tasks: [[${P}]] | all}}`, tasks).split("\n")).toHaveLength(3);
    const folder = expandTaskEmbeds("{{tasks: Viagens/2026-11-travel}}", tasks);
    expect(folder).toContain("remedios.md:5");
    expect(folder).toContain("checklist.md:29");
  });
  it("says so when the note has no matching tasks", () => {
    expect(expandTaskEmbeds("{{tasks: Casa/nada.md}}", tasks)).toBe("_(no open tasks in Casa/nada.md)_");
  });
});

describe("answer parts and task text", () => {
  it("returns the answer as Markdown runs and linked tasks, in order", () => {
    const r = linkTaskLines(`Intro\n{{tasks}}\n${P}:29 [ ] ${tasks[0].text}\nFim`.replace("{{tasks}}\n", ""), tasks)!;
    expect(r.parts.map((p) => p.kind)).toEqual(["md", "task", "md"]);
    expect((r.parts[0] as { text: string }).text).toContain("Intro");
    expect((r.parts[0] as { text: string }).text).toContain("[[Viagens/2026-11-travel/checklist.md|checklist]]");
  });
  it("splits a task into its text and its trailing link/reminder", () => {
    expect(splitTaskText(tasks[0].text)).toEqual({
      main: "St Christopher's, Edimburgo: check-in online antes da chegada, pelo link do e-mail de confirmação.",
      meta: "[[hospedagem#Edimburgo]] ⏰ 25/11 18:00 IS",
    });
    expect(splitTaskText("Comprar adaptador")).toEqual({ main: "Comprar adaptador", meta: "" });
  });
});
