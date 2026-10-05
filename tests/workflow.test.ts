import { expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { downloadForms } from "@/lib/agent";
import { run } from "@/lib/db";
import { listForms } from "@/lib/forms";
import { getHospital, listHospitals, matchHospitalByPhone, saveHospital } from "@/lib/hospitals";
import { progress } from "@/lib/progress";
import { summarize } from "@/lib/summary";
import { createTransfer, defaultDetails, getTransfer, updateTransfer } from "@/lib/transfers";
import { record } from "./fixture";

vi.mock("@/lib/llm", () => ({ askForObject: vi.fn() }));

test("the built-in facilities are added on first use, each with a workflow", async () => {
  const hospitals = await listHospitals();
  expect(hospitals.map((h) => h.id).sort()).toEqual(["cedars", "keck", "ucla"]);
  expect(hospitals.every((h) => h.workflow.length > 0)).toBe(true);
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
