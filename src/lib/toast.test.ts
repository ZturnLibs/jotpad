import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearToasts,
  dismissToast,
  getToasts,
  showToast,
  updateToast,
} from "@/lib/toast";

afterEach(() => {
  clearToasts();
  vi.useRealTimers();
});

describe("toast", () => {
  it("shows and updates by id in place", () => {
    showToast({ id: "a", title: "one" });
    showToast({ id: "a", title: "two", body: "b" });
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].title).toBe("two");
    expect(getToasts()[0].body).toBe("b");
  });

  it("caps at 3 and drops oldest dismissible", () => {
    showToast({ id: "1", title: "1" });
    showToast({ id: "2", title: "2" });
    showToast({ id: "3", title: "3" });
    showToast({ id: "4", title: "4" });
    expect(getToasts().map((t) => t.id)).toEqual(["2", "3", "4"]);
  });

  it("auto-dismisses after durationMs", () => {
    vi.useFakeTimers();
    showToast({ id: "x", title: "t", durationMs: 1000 });
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(getToasts()).toHaveLength(0);
  });

  it("updateToast patches fields", () => {
    showToast({ id: "p", title: "t", progress: 0 });
    updateToast("p", { progress: 50, title: "t2" });
    expect(getToasts()[0].progress).toBe(50);
    expect(getToasts()[0].title).toBe("t2");
    dismissToast("p");
    expect(getToasts()).toHaveLength(0);
  });
});
