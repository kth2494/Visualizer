import { expect, test } from "@playwright/test";

test("an action attached to a path appears in the sequential export", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#point-1-0")).toBeVisible();

  await page.getByTitle("Edit robot actions").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add timed action" }).click();
  await dialog.getByLabel("Action name").fill("발사");
  await dialog.getByLabel("Step 1 code").fill("shoot();");
  await dialog.getByLabel("Fields").fill("private Shooter shooter;");
  await dialog.getByTitle("Close").click();

  await page.getByRole("checkbox", { name: "발사" }).check();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByText("Export sequential command").click();
  await expect(page.getByText("shoot();")).toBeVisible();
  await expect(page.getByText("private Shooter shooter;")).toBeVisible();
});
