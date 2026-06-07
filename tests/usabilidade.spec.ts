import { expect, test } from "@playwright/test";

test("exibe os paineis centrais do editor", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Edicao automatizada para videos sociais.")).toBeVisible();
  await expect(page.getByText("Upload multiplo com validacao")).toBeVisible();
  await expect(page.getByText("Timeline visual")).toBeVisible();
  await expect(page.getByText("Timeline de audio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Processar projeto" })).toBeVisible();
});
