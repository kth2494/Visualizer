import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { javaFilesFor } from "../src/cloud/exportJava";
import { createDefaultProject } from "../src/io";
import { zipFiles } from "../src/utils/zip";
import { DEFAULT_ROBOT } from "./support/fixtures";

const doc = createDefaultProject(DEFAULT_ROBOT, "biobuzz.webp");

describe("exporting every cloud auto", () => {
  it("names each file after its class, never twice", () => {
    const files = javaFilesFor([
      { name: "Red Left", doc },
      { name: "red-left", doc },
      { name: "오토", doc },
    ]);
    expect(files.map((f) => f.name)).toEqual([
      "RedLeft.java",
      // Same name on a case-insensitive disk (Windows, macOS), so numbered.
      "Redleft2.java",
      "오토.java",
    ]);
    expect(files[1].text).toContain("public class Redleft2");
    expect(files[0].text).toContain(
      "package org.firstinspires.ftc.teamcode.auto;",
    );
  });

  it("zips them so unzip reads them back", async () => {
    const files = [
      { name: "A.java", text: "class A {}\n" },
      { name: "B.java", text: "// 한글\n" },
    ];
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const path = join(dir, "autos.zip");
    writeFileSync(path, Buffer.from(await zipFiles(files).arrayBuffer()));
    execFileSync("unzip", ["-tq", path]);
    expect(execFileSync("unzip", ["-p", path, "A.java"]).toString()).toBe(
      "class A {}\n",
    );
    expect(execFileSync("unzip", ["-p", path, "B.java"]).toString()).toBe(
      "// 한글\n",
    );
  });
});
