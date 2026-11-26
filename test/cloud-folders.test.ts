import { describe, expect, it } from "vitest";
import { cleanFolder, isWithin, subfolders } from "../src/cloud/folders";

const paths = ["Red", "Red/Left", "Red/Left/Old", "Red/Right", "Blue", ""];

describe("cloud folders", () => {
  it("cleans a typed path", () => {
    expect(cleanFolder("  Red / /Left ")).toBe("Red/Left");
    expect(cleanFolder(" / ")).toBe("");
  });

  it("lists only the folders one level down", () => {
    expect(subfolders(paths, "")).toEqual(["Blue", "Red"]);
    expect(subfolders(paths, "Red")).toEqual(["Red/Left", "Red/Right"]);
    expect(subfolders(paths, "Red/Left")).toEqual(["Red/Left/Old"]);
    expect(subfolders(paths, "Blue")).toEqual([]);
  });

  it("counts a folder's own autos and everything below it", () => {
    expect(paths.filter((p) => isWithin(p, "Red"))).toEqual([
      "Red",
      "Red/Left",
      "Red/Left/Old",
      "Red/Right",
    ]);
    expect(paths.filter((p) => isWithin(p, "Red/Left"))).toEqual([
      "Red/Left",
      "Red/Left/Old",
    ]);
    // "Redwood" is not inside "Red".
    expect(isWithin("Redwood", "Red")).toBe(false);
    expect(paths.filter((p) => isWithin(p, ""))).toEqual(paths);
  });
});
