import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValidationThreshold } from "@korzun/epubcheck-ts";
import { parseEpub } from "../services/epub-parser";
import { validateEpubReport } from "../services/epub-validator";
import {
  FIXTURES,
  deriveAllCapsTitle,
  deriveNoCover,
  deriveWithWarning,
  demoFixturesDir,
} from "./fixtures";

const src = () => path.join(demoFixturesDir(), FIXTURES.princessOfMars);

describe("demo fixtures", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demo-fixtures-"));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("every fixture exists and parses with a title", () => {
    for (const name of Object.values(FIXTURES)) {
      const file = path.join(demoFixturesDir(), name);
      expect(fs.existsSync(file), name).toBe(true);
      expect(parseEpub(file).title.length, name).toBeGreaterThan(0);
    }
  });

  it("deriveNoCover yields a book without a cover and the same title", () => {
    const out = path.join(tmp, "nocover.epub");
    deriveNoCover(src(), out);
    const meta = parseEpub(out);
    expect(meta.coverData).toBeFalsy();
    expect(meta.title).toBe(parseEpub(src()).title);
    expect(parseEpub(src()).coverData).toBeTruthy();
  });

  it("deriveAllCapsTitle upper-cases the title", () => {
    const out = path.join(tmp, "caps.epub");
    deriveAllCapsTitle(src(), out);
    expect(parseEpub(out).title).toBe(parseEpub(src()).title.toUpperCase());
  });

  it("deriveWithWarning is valid at ERROR threshold but has a WARNING", async () => {
    const out = path.join(tmp, "warn.epub");
    deriveWithWarning(src(), out);
    const report = await validateEpubReport(
      fs.readFileSync(out),
      ValidationThreshold.ERROR,
    );
    expect(report.valid).toBe(true);
    expect(report.messages.some((m) => m.severity === "WARNING")).toBe(true);
    expect(
      report.messages.some(
        (m) => m.severity === "ERROR" || m.severity === "FATAL",
      ),
    ).toBe(false);
  });

  it("deriveNoCover output still passes validation", async () => {
    const out = path.join(tmp, "nocover2.epub");
    deriveNoCover(src(), out);
    const report = await validateEpubReport(
      fs.readFileSync(out),
      ValidationThreshold.ERROR,
    );
    expect(report.valid).toBe(true);
  });
});
