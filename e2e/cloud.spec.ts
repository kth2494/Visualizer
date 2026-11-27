import { expect, test } from "@playwright/test";

// The service worker would answer fetches before these mocks see them.
test.use({ serviceWorkers: "block" });

test("lists, deletes and uploads cloud autos", async ({ page }) => {
  const requests: { method: string; body: unknown; password: string }[] = [];
  let autos: {
    id: string;
    name: string;
    updatedAt: string;
    createdAt: string;
    folder?: string;
  }[] = [
    {
      id: "auto:1",
      name: "오토1",
      updatedAt: "2026-11-01T00:00:00Z",
      createdAt: "2026-10-01T00:00:00Z",
    },
    {
      id: "auto:3",
      name: "오토10",
      updatedAt: "2026-11-02T00:00:00Z",
      createdAt: "2026-09-01T00:00:00Z",
    },
  ];
  const stored = {
    startPoint: { x: 10, y: 20, headingDeg: 90 },
    lines: [],
    shapes: [],
    sequence: [],
    fieldPoints: [],
    activePaths: [],
  };
  await page.route(/\/api\/autos/, async (route) => {
    const request = route.request();
    const body = request.postData() ? JSON.parse(request.postData()!) : null;
    requests.push({
      method: request.method(),
      body,
      password: request.headers()["x-team-password"],
    });
    if (request.method() === "DELETE") autos = [];
    if (request.method() === "PATCH") {
      autos = autos.map((auto) =>
        auto.id === body.id
          ? { ...auto, folder: body.folder || undefined }
          : auto,
      );
    }
    const one = new URL(request.url()).searchParams.has("id");
    await route.fulfill({
      json:
        request.method() === "POST"
          ? { id: "auto:2" }
          : one
            ? { doc: stored }
            : autos,
    });
  });
  // Joining the new room is not part of this test.
  await page.route("**/api/liveblocks-auth", (route) =>
    route.fulfill({ status: 500 }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Cloud autos…" }).click();
  await page.getByRole("textbox", { name: "Team password" }).fill("bees");
  await page.getByRole("button", { name: "Continue" }).click();

  const list = page.getByRole("list", { name: "Cloud autos" });
  await expect(list).toContainText("오토1");
  const names = () => list.locator("li p:first-child").allInnerTexts();
  // Recently opened first, then by name with 1 before 10.
  expect(await names()).toEqual(["오토10", "오토1"]);
  await page.getByLabel("Sort by").selectOption("name");
  expect(await names()).toEqual(["오토1", "오토10"]);
  expect(requests[0]).toMatchObject({ method: "GET", password: "bees" });

  // Filed in a folder, 오토10 shows only once you go into the folder.
  await list.getByRole("button", { name: "Folder" }).nth(1).click();
  await page.getByRole("textbox", { name: "Move to folder" }).fill("Red");
  await page.getByRole("button", { name: "Move" }).click();
  expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
    id: "auto:3",
    folder: "Red",
  });
  await expect(list.getByRole("button", { name: /Red/ })).toBeVisible();
  expect(await names()).toEqual(["오토1"]);
  await list.getByRole("button", { name: /Red/ }).click();
  expect(await names()).toEqual(["오토10"]);
  await page.getByRole("button", { name: "← Cloud autos" }).click();
  expect(await names()).toEqual(["오토1"]);

  await list.getByRole("button", { name: "Duplicate" }).first().click();
  await page.getByRole("button", { name: "As is" }).click();
  await page.getByRole("button", { name: "Duplicate" }).last().click();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => requests.find((r) => r.method === "POST")?.body)
    .toEqual({ name: "오토1 copy", copyOf: "auto:1" });
  requests.length = 0;

  // The copy can go into another folder.
  await list.getByRole("button", { name: "Duplicate" }).first().click();
  await page.getByRole("button", { name: "As is" }).click();
  await page.getByRole("button", { name: "Duplicate" }).last().click();
  await page
    .getByRole("textbox", { name: "Copy into folder" })
    .fill("Blue/Old");
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => requests.find((r) => r.method === "POST")?.body)
    .toEqual({ name: "오토1 copy", copyOf: "auto:1", folder: "Blue/Old" });
  requests.length = 0;

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export all as Java (.zip)" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("cloud-autos-java.zip");
  const zip = Buffer.concat(
    await (await download.createReadStream()).toArray(),
  ).toString("utf8");
  expect(zip).toContain("오토1.java");
  expect(zip).toContain("public class 오토1");
  requests.length = 0;

  // Flipped both ways: the start lands across the field's center, turned around.
  await list.getByRole("button", { name: "Duplicate" }).first().click();
  await page.getByRole("button", { name: "Both" }).click();
  await page.getByRole("button", { name: "Duplicate" }).last().click();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => requests.find((r) => r.method === "POST")?.body)
    .toMatchObject({
      name: "오토1 rotated",
      doc: { startPoint: { x: 131.5, y: 121.5, headingDeg: -90 } },
    });
  requests.length = 0;

  await list.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("button", { name: "Delete" }).last().click();
  await expect(page.getByText("No cloud autos yet.")).toBeVisible();
  expect(requests.find((r) => r.method === "DELETE")?.body).toEqual({
    id: "auto:1",
  });

  // A new folder is entered right away; what is made there lands in it.
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("textbox", { name: "New folder" }).fill("Blue");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("This folder is empty.")).toBeVisible();

  await page.getByRole("button", { name: "Upload current" }).click();
  await page.getByRole("textbox", { name: "New cloud auto" }).fill("오토2");
  await page.getByRole("button", { name: "Create" }).click();
  await expect
    .poll(() => requests.find((r) => r.method === "POST")?.body)
    .toMatchObject({
      name: "오토2",
      folder: "Blue",
      doc: { lines: expect.any(Array) },
    });
});

test("folders nest, and export takes the folder you are in", async ({
  page,
}) => {
  const at = "2026-11-01T00:00:00Z";
  const autos = [
    {
      id: "auto:a",
      name: "Alpha",
      updatedAt: at,
      createdAt: at,
      folder: "Red",
    },
    {
      id: "auto:b",
      name: "Bravo",
      updatedAt: at,
      createdAt: at,
      folder: "Red/Left",
    },
    { id: "auto:c", name: "Charlie", updatedAt: at, createdAt: at },
  ];
  const doc = {
    startPoint: { x: 10, y: 20, headingDeg: 90 },
    lines: [],
    shapes: [],
    sequence: [],
    fieldPoints: [],
    activePaths: [],
  };
  await page.route(/\/api\/autos/, (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has("id")
        ? { doc }
        : autos,
    }),
  );
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("pedro_team_password", "x"));
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Cloud autos…" }).click();

  const list = page.getByRole("list", { name: "Cloud autos" });
  const exported = async (label: string) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: label }).click(),
    ]);
    const zip = (await (await download.createReadStream()).toArray())
      .map((chunk) => chunk.toString("latin1"))
      .join("");
    return {
      file: download.suggestedFilename(),
      autos: ["Alpha", "Bravo", "Charlie"].filter((n) =>
        zip.includes(`${n}.java`),
      ),
    };
  };

  await expect(list.getByRole("button", { name: "Red (2)" })).toBeVisible();
  expect(await exported("Export all as Java (.zip)")).toEqual({
    file: "cloud-autos-java.zip",
    autos: ["Alpha", "Bravo", "Charlie"],
  });

  await list.getByRole("button", { name: "Red (2)" }).click();
  await expect(list.getByRole("button", { name: "Left (1)" })).toBeVisible();
  await expect(list).toContainText("Alpha");
  await expect(list).not.toContainText("Bravo");
  expect(await exported("Export this folder as Java (.zip)")).toEqual({
    file: "Red-java.zip",
    autos: ["Alpha", "Bravo"],
  });

  await list.getByRole("button", { name: "Left (1)" }).click();
  await expect(list).toContainText("Bravo");
  expect(await exported("Export this folder as Java (.zip)")).toEqual({
    file: "Left-java.zip",
    autos: ["Bravo"],
  });

  // The trail goes back up one level at a time.
  await page
    .getByRole("navigation", { name: "Folder path" })
    .getByRole("button", { name: "Red" })
    .click();
  await expect(list).toContainText("Alpha");
});
