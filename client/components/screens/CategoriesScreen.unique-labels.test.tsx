// Session 22, item 1 (owner's answer; approved and merged in session 23, 2f5d30c): no two categories in a picker may
// share a label. The travel "Shopping" is now "Souvenirs & shopping" (owner's
// wording), and the built-in labels are all different. A custom category
// could still repeat one: adding "Shopping" made a second "Shopping"
// (shopping-2). Adding or renaming one to a label already in the pickers
// (ignoring case and surrounding spaces) is refused, and says why (approved; approved and merged in session 23, 2f5d30c).
// Changing only the case of a category's own name is allowed.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import CategoriesScreen from "./CategoriesScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { CATEGORIES, DEFAULT_DATA, categoryLabel, type LocalFinancials } from "../../lib/localData";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function show(o: Partial<LocalFinancials> = {}) {
  const onChange = vi.fn<(f: LocalFinancials) => void>();
  const data = { ...DEFAULT_DATA, income: 3000, customCategories: [], categoryRules: [], transactions: [], recurring: [], ...o } as LocalFinancials;
  render(<ThemeProvider><CategoriesScreen financials={data} onChange={onChange} /></ThemeProvider>);
  return { onChange };
}
const type = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });
const PET = { value: "pet-care", label: "Pet care", icon: "🐾" };

it("the travel shopping category reads \"Souvenirs & shopping\", and every built-in label is different", () => {
  expect(categoryLabel("travel-shopping")).toBe("Souvenirs & shopping");
  expect(categoryLabel("shopping")).toBe("Shopping");
  const labels = CATEGORIES.map((c) => c.label.trim().toLowerCase());
  expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
});

it("adding a category named like a built-in one is refused, and says why", () => {
  const { onChange } = show();
  type("new-cat-name", "  shopping ");
  fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toBe("There's already a category called Shopping.");
});

it("adding one named like a custom one is refused too", () => {
  const { onChange } = show({ customCategories: [PET] });
  type("new-cat-name", "PET CARE");
  fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toBe("There's already a category called Pet care.");
});

it("a new name is added as before, and the message goes once the name changes", () => {
  const { onChange } = show();
  type("new-cat-name", "Shopping");
  fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
  type("new-cat-name", "Pottery");
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
  expect(onChange.mock.calls.at(-1)![0].customCategories).toEqual([expect.objectContaining({ value: "pottery", label: "Pottery" })]);
});

it("renaming a category to another's label is refused; changing only its own case is allowed", () => {
  const { onChange } = show({ customCategories: [PET] });
  fireEvent.click(screen.getByRole("button", { name: "Edit Pet care category" }));
  type("edit-cat-name", "Groceries");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toBe(`There's already a category called ${categoryLabel("groceries")}.`);
  type("edit-cat-name", "Pet Care");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onChange.mock.calls.at(-1)![0].customCategories).toEqual([expect.objectContaining({ value: "pet-care", label: "Pet Care" })]);
});
