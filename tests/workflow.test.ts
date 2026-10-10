import { expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyTo, downloadForms, recordOutcome } from "@/lib/agent";
import { audit, run } from "@/lib/db";
import { listForms } from "@/lib/forms";
import { deleteHospital, getHospital, HOSPITALS, listHospitals, matchHospitalByPhone, saveHospital } from "@/lib/hospitals";
import { progress } from "@/lib/progress";
import { summarize } from "@/lib/summary";
import { createTransfer, defaultDetails, getTransfer, updateTransfer } from "@/lib/transfers";
import { record } from "./fixture";

vi.mock("@/lib/llm", () => ({ askForObject: vi.fn() }));

test("the built-in facilities are added on first use, each with a workflow", async () => {
  const hospitals = await listHospitals();
  expect(hospitals.map((h) => h.id).sort()).toEqual(HOSPITALS.map((h) => h.id).sort());
  expect(hospitals.every((h) => h.workflow.length > 0)).toBe(true);
});

test("built-in facilities get our updates unless staff edited them", async () => {
  const ucla = (await getHospital("ucla"))!;
  await saveHospital({ ...ucla, intakeNotes: "old notes" });
  expect((await getHospital("ucla"))!.intakeNotes).toBe(ucla.intakeNotes);
  await saveHospital({ ...ucla, intakeNotes: "staff notes", edited: true });
  expect((await getHospital("ucla"))!.intakeNotes).toBe("staff notes");
  await saveHospital(ucla);
});

test("a built-in facility that staff deleted is not added back", async () => {
  const sharp = (await getHospital("sharp"))!;
  await deleteHospital("sharp");
  await audit("user", "facility.delete", null, "sharp");
  expect(await getHospital("sharp")).toBeUndefined();
  await saveHospital(sharp);
});

test("staff can add a facility; its numbers match inbound calls and faxes", async () => {
  const keck = (await getHospital("keck"))!;
  await saveHospital({ ...keck, id: "huntington", name: "Huntington Hospital", transferPhone: "+16263975000", transferFax: null, workflow: [{ type: "call", note: "", number: "+16265550199" }] });
  expect((await getHospital("huntington"))!.name).toBe("Huntington Hospital");
  expect((await matchHospitalByPhone("(626) 555-0199"))?.id).toBe("huntington");
  expect(await matchHospitalByPhone("")).toBeUndefined();
});

test("a transfer follows its facility's workflow: calls, faxes and skips complete the steps in order", async () => {
  const id = await createTransfer({ patientId: "eTest123", patientName: "Camila Maria Lopez", reason: "NSTEMI", details: defaultDetails(), summary: summarize(record) });
  const cedars = (await getHospital("cedars"))!; // forms, fax, call, wait for their call
  await updateTransfer(id, { hospitalId: "cedars", workflow: cedars.workflow });

  const steps = async () => (await progress((await getTransfer(id))!)).steps.map((s) => `${s.title}:${s.done ? "done" : "todo"}`);
  expect(await steps()).toEqual(["Chart:done", "Hospital:done", "Forms:todo", "Fax:todo", "Call:todo", "Their call:todo", "Outcome:todo"]);

  await run("INSERT INTO faxes (transfer_id, to_number, provider, status, pdf) VALUES ($1, '+13104233305', 'mock', 'sent', $2)", [id, Buffer.from("")]);
  await run("INSERT INTO calls (transfer_id, direction, number, status) VALUES ($1, 'outbound', '+13104232400', 'completed')", [id]);
  await updateTransfer(id, { skipped: [0] }); // no forms needed this time
  expect(await steps()).toEqual(["Chart:done", "Hospital:done", "Forms:done", "Fax:done", "Call:done", "Their call:todo", "Outcome:todo"]);
  expect((await progress((await getTransfer(id))!)).next).toBe("w3");
});

test("the nurse's hospitals are applied to in order: a decline moves on to the next, the last one closes the transfer", async () => {
  const id = await createTransfer({ patientId: "eTest123", patientName: "Camila Maria Lopez", reason: "NSTEMI", details: defaultDetails(), summary: summarize(record) });
  await updateTransfer(id, { choices: ["keck", "ucla"] });
  await applyTo(id, "keck");
  await run("INSERT INTO faxes (transfer_id, to_number, provider, status, pdf, created_at) VALUES ($1, '+13234425240', 'mock', 'sent', $2, '2000-01-01 00:00:00')", [id, Buffer.from("")]);

  expect(await recordOutcome(id, "declined", "No ICU beds", "ai-voice")).toBeTypeOf("function");
  const t = (await getTransfer(id))!;
  expect(t).toMatchObject({ hospitalId: "ucla", status: "open", workflow: (await getHospital("ucla"))!.workflow });
  expect((await progress(t)).steps.every((s) => s.done === ["Chart", "Hospital"].includes(s.title))).toBe(true); // Keck's fax doesn't count for UCLA

  expect(await recordOutcome(id, "declined", "No neurosurgery", "user")).toBeNull();
  expect(await getTransfer(id)).toMatchObject({ hospitalId: "ucla", status: "declined", outcomeReason: "No neurosurgery" });
});

test("a facility's public forms are downloaded once into the forms inbox", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const pdf = await doc.save();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf" } }));

  const ids = await downloadForms("cedars");
  expect(ids).toHaveLength(1);
  const [form] = await listForms("cedars");
  expect(form).toMatchObject({ source: "web", name: "Non EMTALA Request for Transfer to Cedars Sinai Inpatient" });
  expect(await downloadForms("cedars")).toEqual([]); // already on file
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockRestore();
});
