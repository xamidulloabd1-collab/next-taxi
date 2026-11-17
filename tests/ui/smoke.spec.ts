import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, phone: string, app: "passenger" | "driver" | "admin") {
  await page.goto(`/${app}/login`);
  await page.getByLabel("Telefon raqami").fill(phone.replace("+998", ""));
  await page.getByRole("button", { name: "Kod olish" }).click();
  const code = (await page.locator(".font-mono.font-bold").textContent())?.trim() ?? "";
  await page.getByLabel("Tasdiqlash kodi").fill(code);
  await page.getByRole("button", { name: "Tasdiqlash" }).click();
}

test("passenger signs in through the OTP form and reaches the booking screen", async ({ page }) => {
  // Fresh number per run: the OTP endpoint allows 3 codes per phone per 10 minutes.
  await login(page, `+99893${String(Date.now()).slice(-7)}`, "passenger");
  await expect(page.getByRole("heading", { name: "Qayerga boramiz?" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Narxni ko‘rish" })).toBeVisible();
});

test("driver signs in and sees the work screen", async ({ page }) => {
  await login(page, "+998902222221", "driver");
  await expect(page.getByRole("switch")).toBeVisible({ timeout: 20_000 });
});

test("admin signs in and sees role-filtered navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "+998900000001", "admin");
  await expect(page.getByRole("heading", { name: "Umumiy holat" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Audit jurnali" })).toBeVisible();
});

test("signed-out users are redirected to login", async ({ page }) => {
  await page.goto("/admin/finance");
  await expect(page).toHaveURL(/\/admin\/login/);
});
