import { describe, expect, it } from "vitest";
import { publicUrl } from "../src/utils/publicUrl";
import { fieldMapSource } from "../src/view/fieldMap";
import { DEFAULT_SETTINGS } from "../src/config/defaults";

describe("publicUrl", () => {
  it("makes bundled root paths relative so a sub-path deploy finds them", () => {
    expect(publicUrl("/robot.png")).toBe("./robot.png");
    expect(publicUrl("/fields/decode.webp")).toBe("./fields/decode.webp");
  });

  it("leaves data, remote and protocol-relative URLs alone", () => {
    expect(publicUrl("data:image/png;base64,AA")).toBe(
      "data:image/png;base64,AA",
    );
    expect(publicUrl("https://x.dev/a.png")).toBe("https://x.dev/a.png");
    expect(publicUrl("//cdn.dev/a.png")).toBe("//cdn.dev/a.png");
  });

  it("is applied to field images", () => {
    expect(fieldMapSource(DEFAULT_SETTINGS, "dark")).toMatch(/^\.\/fields\//);
  });
});
