import { expect, test } from "@playwright/test";

// The service worker would answer fetches before these mocks see them.
test.use({ serviceWorkers: "block" });

test("lists, deletes and uploads cloud autos", async ({ page }) => {
  const requests: { method: string; body: unknown; password: string }[] = [];
  let autos = [
    { id: "auto:1", name: "오토1", updatedAt: "2026-11-01T00:00:00Z" },
  ];
  await page.route("**/api/autos", async (route) => {
    const request = route.request();
    const body = request.postData() ? JSON.parse(request.postData()!) : null;
    requests.push({
      method: request.method(),
      body,
      password: request.headers()["x-team-password"],
    });
    if (request.method() === "DELETE") autos = [];
    await route.fulfill({
      json: request.method() === "POST" ? { id: "auto:2" } : autos,
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
  expect(requests[0]).toMatchObject({ method: "GET", password: "bees" });

  await list.getByRole("button", { name: "Duplicate" }).click();
  await page.getByRole("button", { name: "Duplicate" }).last().click();
  await expect
    .poll(() => requests.find((r) => r.method === "POST")?.body)
    .toEqual({ name: "오토1 copy", copyOf: "auto:1" });
  requests.length = 0;

  await list.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete" }).last().click();
  await expect(page.getByText("No cloud autos yet.")).toBeVisible();
  expect(requests.find((r) => r.method === "DELETE")?.body).toEqual({
    id: "auto:1",
  });

  await page.getByRole("button", { name: "Upload current" }).click();
  await page.getByRole("textbox", { name: "New cloud auto" }).fill("오토2");
  await page.getByRole("button", { name: "Create" }).click();
  await expect
    .poll(() => requests.find((r) => r.method === "POST")?.body)
    .toMatchObject({ name: "오토2", doc: { lines: expect.any(Array) } });
});
