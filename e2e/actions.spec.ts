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

test("the robot shows the running action during playback", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#point-1-0")).toBeVisible();

  await page.getByTitle("Edit robot actions").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add timed action" }).click();
  await dialog.getByLabel("Action name").fill("발사");
  await dialog.getByLabel("Total time (ms)").fill("60000");
  await dialog.getByTitle("Close").click();
  await page.getByRole("checkbox", { name: "발사" }).check();

  // A one-minute shot after a short path fills almost all of the clock.
  await page.getByLabel("Playback position").fill("90");
  await expect(page.getByTestId("action-label")).toContainText("발사");
});

test("the sequential export saves a .java file named after the class", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#point-1-0")).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByText("Export sequential command").click();
  await page.getByPlaceholder("AutoPath").fill("LRightEnd");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save .java" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("LRightEnd.java");
  const text = await (
    await download.createReadStream()
  )
    .toArray()
    .then((chunks) => Buffer.concat(chunks).toString());
  expect(text).toContain("public class LRightEnd extends LinearOpMode");
});

test("a new project starts with the last edited actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#point-1-0")).toBeVisible();

  await page.getByTitle("Edit robot actions").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add timed action" }).click();
  await dialog.getByLabel("Action name").fill("발사");
  await dialog.getByLabel("Fields").fill("private Shooter shooter;");
  await dialog.getByTitle("Close").click();

  await page.getByRole("button", { name: "File" }).click();
  await page.getByText("New project").click();
  await page.getByRole("button", { name: "Discard changes" }).click();

  await expect(page.getByRole("checkbox", { name: "발사" })).not.toBeChecked();
  await page.getByTitle("Edit robot actions").click();
  await expect(page.getByLabel("Action name")).toHaveValue("발사");
  await expect(page.getByLabel("Fields")).toHaveValue(
    "private Shooter shooter;",
  );
});

test("the field warns when a path drives into the field wall", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#point-1-0")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByLabel("End X", { exact: true }).fill("2");
  await expect(page.getByRole("alert")).toContainText(
    "Path 1 hits the field wall",
  );

  // The code export stays free of the warning.
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByText("Export sequential command").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
});

test("send to robot posts the routine to the robot", async ({ page }) => {
  let posted = "";
  await page.route("http://192.168.43.1:8080/pedro/routine", async (route) => {
    posted = route.request().postData() ?? "";
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: true, name: "auto", steps: 1 }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#point-1-0")).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByText("Send to robot").click();
  await page.getByLabel("Routine name").fill("auto");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByRole("status")).toContainText('Sent "auto"');
  const routine = JSON.parse(posted);
  expect(routine.format).toBe("pedro-routine");
  expect(routine.steps[0]).toEqual({ path: "path1" });
});

test("an exported sequential command opens back for editing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#point-1-0")).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByText("Export sequential command").click();
  await page.getByPlaceholder("AutoPath").fill("Reopened");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save .java" }).click(),
  ]);
  const java = (await (await download.createReadStream()).toArray())
    .map((chunk) => chunk.toString())
    .join("")
    .replace(/poseFactory\.of\([^,]+/, "poseFactory.of(40");
  await page.getByTitle("Close").click();

  await page.getByRole("button", { name: "File" }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByText("Open Java…").click(),
  ]);
  await chooser.setFiles({
    name: "Reopened.java",
    mimeType: "text/x-java",
    buffer: Buffer.from(java),
  });

  await expect(page.locator("#point-1-0")).toBeVisible();
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByText("Export sequential command").click();
  await expect(page.getByPlaceholder("AutoPath")).toHaveValue("Reopened");
  await expect(page.getByText("poseFactory.of(40,")).toBeVisible();
});
