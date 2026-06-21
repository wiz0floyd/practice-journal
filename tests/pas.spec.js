import { test, expect } from "@playwright/test";

// Seed localStorage with legacy hot/warm/cold items for migration tests
const seedLegacy = async (page) => {
  await page.addInitScript(() => {
    const items = [
      { id: "i1", composer: "Bach",   title: "Prelude",    detail: "", tags: [], notes: "" },
      { id: "i2", composer: "Mozart", title: "Sonata",     detail: "", tags: [], notes: "" },
      { id: "i3", composer: "Brahms", title: "Intermezzo", detail: "", tags: [], notes: "" },
    ];
    const cards = [
      { id: "i1", bucket: "hot",  sessionsUntilDue: 0, history: [] },
      { id: "i2", bucket: "warm", sessionsUntilDue: 0, history: [] },
      { id: "i3", bucket: "cold", sessionsUntilDue: 0, history: [] },
    ];
    localStorage.setItem("pj_items_v1", JSON.stringify(items));
    localStorage.setItem("pj_cards_v1", JSON.stringify(cards));
  });
};

// T1 — Data migration: legacy hot/warm/cold → Kaplan labels, no legacy text in DOM
test("T1: data migration from hot/warm/cold to Kaplan categories", async ({ page }) => {
  await seedLegacy(page);
  await page.goto("/practice-journal/");

  // Kaplan labels should appear at least once
  await expect(page.getByText("Needs Work").first()).toBeVisible();
  await expect(page.getByText("In Progress").first()).toBeVisible();
  await expect(page.getByText("Performance-Ready").first()).toBeVisible();

  // No legacy bucket text as badge label (check badge spans specifically)
  const badges = page.locator("span").filter({ hasText: /^(Needs Work|In Progress|Performance-Ready)$/ });
  await expect(badges.first()).toBeVisible();

  // Body text should not contain the old bucket names as standalone labels
  const badgeTexts = await page.locator("span[style*='border']").allInnerTexts();
  for (const t of badgeTexts) {
    expect(t.toLowerCase()).not.toMatch(/^hot$|^warm$|^cold$/);
  }
});

// T2 — DPO opens from dashboard (not directly to assess)
test("T2: Begin session opens DPO, not assess", async ({ page }) => {
  await seedLegacy(page);
  await page.goto("/practice-journal/");

  await page.getByRole("button", { name: /begin session/i }).click();

  await expect(page.getByText("Daily Practice Organizer")).toBeVisible();
  // All 3 items should appear as rows
  await expect(page.getByText("Prelude")).toBeVisible();
  await expect(page.getByText("Sonata")).toBeVisible();
  await expect(page.getByText("Intermezzo")).toBeVisible();
});

// T3 — DPO time budget: 20% deduction and over-budget indicator
test("T3: DPO time budget shows 80% of total and flags over-budget", async ({ page }) => {
  await seedLegacy(page);
  await page.goto("/practice-journal/");
  await page.getByRole("button", { name: /begin session/i }).click();

  // Set total to 60 min — practice time should show 48 min
  const totalInput = page.getByLabel("Total time available in minutes");
  await totalInput.fill("60");
  // The <strong> element inside the practice time display should say "48 min"
  await expect(page.locator("strong").filter({ hasText: "48 min" })).toBeVisible();

  // Set each row to 30 min (3 rows × 30 = 90 > 48) to trigger over-budget
  const minInputs = page.getByLabel("Minutes for this item");
  for (const inp of await minInputs.all()) {
    await inp.fill("30");
  }
  await expect(page.getByText(/over budget/i)).toBeVisible();
});

// T4 — Strategy note from DPO carries through to assess card
test("T4: strategy note appears in assess view", async ({ page }) => {
  await seedLegacy(page);
  await page.goto("/practice-journal/");
  await page.getByRole("button", { name: /begin session/i }).click();

  // Enter a strategy in the first row
  const stratInputs = page.getByPlaceholder("today's goal…");
  await stratInputs.first().fill("Focus on bow speed");

  await page.getByRole("button", { name: /begin session →/i }).click();

  // The strategy text should appear in the assess view
  await expect(page.getByText("Focus on bow speed")).toBeVisible();
  await expect(page.getByText("Today's goal")).toBeVisible();
});

// T5 — Berry selection on fail criterion
test("T5: berry chips appear on fail and are recorded in result", async ({ page }) => {
  await seedLegacy(page);
  await page.goto("/practice-journal/");
  await page.getByRole("button", { name: /begin session/i }).click();
  await page.getByRole("button", { name: /begin session →/i }).click();

  // Fail Rhythm using its aria-label
  await page.getByRole("button", { name: "Rhythm: fail" }).click();

  // Berry chips should appear
  await expect(page.getByRole("button", { name: "Tempo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Evenness" })).toBeVisible();

  // Click Tempo berry
  await page.getByRole("button", { name: "Tempo" }).click();

  // Pass all other criteria
  await page.getByRole("button", { name: "Intonation: pass" }).click();
  await page.getByRole("button", { name: "Tone: pass" }).click();
  await page.getByRole("button", { name: "Expression: pass" }).click();

  // Submit assessment
  const submitBtn = page.getByRole("button", { name: /record assessment/i });
  await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  await submitBtn.click();

  // Result should show Rhythm with Tempo berry (in result view)
  await expect(page.getByText(/Work on today/i)).toBeVisible();
  await expect(page.getByText("Rhythm")).toBeVisible();
  await expect(page.getByText("Tempo")).toBeVisible();

  // Check localStorage history has berries — look at whichever card was assessed
  await page.waitForTimeout(200);
  const assessedCard = await page.evaluate(() => {
    const cards = JSON.parse(localStorage.getItem("pj_cards_v1") || "[]");
    return cards.find((c) => c.history?.length > 0);
  });
  expect(assessedCard?.history?.at(-1)?.berries?.rhythm).toContain("Tempo");
});

// T6 — Category advancement: c → b when all criteria pass (seed a single c-bucket item)
test("T6: passing all criteria promotes from c (Needs Work) to b (In Progress)", async ({ page }) => {
  await page.addInitScript(() => {
    const items = [{ id: "x1", composer: "Bach", title: "Prelude", detail: "", tags: [], notes: "" }];
    const cards = [{ id: "x1", bucket: "hot", sessionsUntilDue: 0, history: [] }];
    localStorage.setItem("pj_items_v1", JSON.stringify(items));
    localStorage.setItem("pj_cards_v1", JSON.stringify(cards));
  });
  await page.goto("/practice-journal/");
  await page.getByRole("button", { name: /begin session/i }).click();
  await page.getByRole("button", { name: /begin session →/i }).click();

  // Pass all 4 criteria using aria-labels
  await page.getByRole("button", { name: "Intonation: pass" }).click();
  await page.getByRole("button", { name: "Rhythm: pass" }).click();
  await page.getByRole("button", { name: "Tone: pass" }).click();
  await page.getByRole("button", { name: "Expression: pass" }).click();

  await page.getByRole("button", { name: /record assessment/i }).click();

  // Result should show promotion from Needs Work → In Progress
  await expect(page.getByText("Needs Work").first()).toBeVisible();
  await expect(page.getByText("In Progress").first()).toBeVisible();
  await expect(page.getByText(/promoted/i)).toBeVisible();
});

// T7 — Back navigation: dash → plan → assess → back → plan
test("T7: browser back from assess returns to DPO plan view", async ({ page }) => {
  await seedLegacy(page);
  await page.goto("/practice-journal/");
  await page.getByRole("button", { name: /begin session/i }).click();
  await expect(page.getByText("Daily Practice Organizer")).toBeVisible();

  await page.getByRole("button", { name: /begin session →/i }).click();
  // Verify we're in assess view (progress indicator visible)
  await expect(page.getByText(/of \d/)).toBeVisible();

  await page.goBack();
  await expect(page.getByText("Daily Practice Organizer")).toBeVisible();
});

// T8 — Non-repertoire segment rows don't appear in assess queue
test("T8: Warm-up segment added to DPO is excluded from assess queue", async ({ page }) => {
  await seedLegacy(page);
  await page.goto("/practice-journal/");
  await page.getByRole("button", { name: /begin session/i }).click();

  // Add a Warm-up segment
  await page.getByRole("button", { name: /\+ Warm-up/i }).click();

  // The Warm-up chip should appear in the table
  await expect(page.getByText("Warm-up").first()).toBeVisible();

  // Begin session — assess queue should still be 3 items (not 4)
  await page.getByRole("button", { name: /begin session →/i }).click();
  await expect(page.getByText("1 of 3")).toBeVisible();
});
