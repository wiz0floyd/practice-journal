import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const seedItems = async (page) => {
  await page.addInitScript(() => {
    const items = [
      { id: "i1", composer: "Bach",   title: "Prelude",    detail: "", tags: [], notes: "" },
      { id: "i2", composer: "Mozart", title: "Sonata",     detail: "", tags: [], notes: "" },
    ];
    const cards = [
      { id: "i1", bucket: "c", sessionsUntilDue: 0, history: [] },
      { id: "i2", bucket: "b", sessionsUntilDue: 0, history: [] },
    ];
    localStorage.setItem("pj_items_v1", JSON.stringify(items));
    localStorage.setItem("pj_cards_v1", JSON.stringify(cards));
  });
};

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "tablet",  width: 768,  height: 1024 },
  { name: "mobile",  width: 375,  height: 812 },
];

const VIEWS = [
  {
    name: "dash",
    setup: async (page) => {
      await seedItems(page);
      await page.goto("/practice-journal/");
    },
  },
  {
    name: "DPO plan",
    setup: async (page) => {
      await seedItems(page);
      await page.goto("/practice-journal/");
      await page.getByRole("button", { name: /begin session/i }).click();
      await expect(page.getByText("Daily Practice Organizer")).toBeVisible();
    },
  },
  {
    name: "repertoire",
    setup: async (page) => {
      await seedItems(page);
      await page.goto("/practice-journal/");
      await page.getByRole("button", { name: /edit →/i }).click();
    },
  },
];

for (const vp of VIEWPORTS) {
  for (const view of VIEWS) {
    test(`a11y: ${view.name} @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await view.setup(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
