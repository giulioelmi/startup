import { expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { processForm } from "@/lib/agent";
import { listFilled } from "@/lib/filled";
import { getForm, saveForm } from "@/lib/forms";
import { summarize } from "@/lib/summary";
import { createTransfer, defaultDetails, updateTransfer } from "@/lib/transfers";
import { record } from "./fixture";

const askForObject = vi.hoisted(() => vi.fn());
vi.mock("@/lib/llm", () => ({ askForObject }));

test("a faxed form is read and filled for the open transfer to that hospital, with no staff action", async () => {
  const transferId = createTransfer({ patientId: "eTest123", patientName: "Camila Maria Lopez", reason: "Stroke, needs thrombectomy", details: defaultDetails(), summary: summarize(record) });
  updateTransfer(transferId, { hospitalId: "cedars" });

  const blank = await PDFDocument.create();
  blank.addPage([612, 792]);
  const formId = await saveForm({ name: "Fax from +13104233305", bytes: await blank.save(), mime: "application/pdf", hospitalId: null, source: "fax" });
  expect(getForm(formId)!.status).toBe("reading");

  askForObject
    .mockResolvedValueOnce({ title: "Request for Transfer", hospital: "cedars", fields: [{ label: "Patient name", type: "text", page: 0, box: [100, 100, 130, 500] }] })
    .mockResolvedValueOnce({ values: [{ name: "ai_1", value: "Camila Maria Lopez", source: "chart: patient.name" }] });

  await processForm(formId);

  const form = getForm(formId)!;
  expect(form).toMatchObject({ status: "ready", hospital_id: "cedars", name: "Request for Transfer" });
  const [filled] = listFilled(transferId);
  expect(filled).toMatchObject({ formId, status: "ready", approvedAt: null });
  expect(filled.values[0].value).toBe("Camila Maria Lopez");
});

test("a form the AI cannot read is marked failed with the reason", async () => {
  const blank = await PDFDocument.create();
  blank.addPage([612, 792]);
  const formId = await saveForm({ name: "x", bytes: await blank.save(), mime: "application/pdf", hospitalId: "keck", source: "upload" });
  askForObject.mockRejectedValueOnce(new Error("model does not support images"));
  await processForm(formId);
  expect(getForm(formId)).toMatchObject({ status: "failed", error: "model does not support images" });
});
