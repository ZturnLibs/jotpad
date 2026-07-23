// Drives the native macOS menu bar: serializes the shared menu model into the
// Rust menu tree, and dispatches click events back to runMenuAction.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { debounce } from "@/lib/utils";
import { platform } from "@/lib/utils";
import { getMenuModel, runMenuAction, type MenuItemModel } from "@/lib/menuActions";

interface MenuDef {
  type: "item" | "check" | "separator" | "submenu";
  id?: string;
  text?: string;
  accelerator?: string;
  checked?: boolean;
  enabled?: boolean;
  items?: MenuDef[];
}

function toDefs(items: MenuItemModel[]): MenuDef[] {
  return items.map((it): MenuDef => {
    if (it.sep) return { type: "separator" };
    if (it.submenu) {
      return {
        type: "submenu",
        text: it.label,
        enabled: it.disabled !== true,
        items: toDefs(it.submenu),
      };
    }
    if (it.checked !== undefined) {
      return {
        type: "check",
        id: it.id,
        text: it.label,
        checked: !!it.checked,
        enabled: it.disabled !== true,
      };
    }
    return {
      type: "item",
      id: it.id,
      text: it.label,
      accelerator: it.accel,
      enabled: it.disabled !== true,
    };
  });
}

/** Rebuild the native menu from the current app state. */
export async function applyNativeMenu(): Promise<void> {
  const model = getMenuModel();
  const isMac = platform() === "macos";
  const menus: MenuDef[] = [];

  if (isMac) {
    // macOS: first submenu becomes the bold app menu. Provide our own named
    // "Jotpad" (capital J) so the OS doesn't synthesize one from the lowercase
    // process/executable name.
    const about = model.file.find((i) => i.id === "about");
    const exit = model.file.find((i) => i.id === "exit");
    const appItems: MenuItemModel[] = [];
    if (about) appItems.push(about);
    appItems.push({ sep: true });
    if (exit) appItems.push(exit);
    menus.push({ type: "submenu", text: "Jotpad", items: toDefs(appItems) });

    // File menu without About/Exit (now in the app menu); trim trailing separator.
    let fileItems = model.file.filter((i) => i.id !== "about" && i.id !== "exit");
    while (fileItems.length && fileItems[fileItems.length - 1].sep) fileItems.pop();
    menus.push({ type: "submenu", text: model.fileLabel, items: toDefs(fileItems) });
  } else {
    menus.push({ type: "submenu", text: model.fileLabel, items: toDefs(model.file) });
  }

  menus.push({ type: "submenu", text: model.editLabel, items: toDefs(model.edit) });
  menus.push({ type: "submenu", text: model.viewLabel, items: toDefs(model.view) });

  try {
    await invoke("set_app_menu", { menus });
  } catch (e) {
    console.error("set_app_menu failed", e);
  }
}

let unlisten: UnlistenFn | undefined;

/** Debounced native menu rebuild — coalesces rapid state changes (e.g. tab switches). */
export const applyNativeMenuDebounced = debounce(() => {
  void applyNativeMenu();
}, 120);

/** Subscribe to native menu clicks. */
export async function startNativeMenuListener(): Promise<void> {
  if (unlisten) return;
  unlisten = await listen<string>("menu://click", (e) => {
    runMenuAction(e.payload);
  });
}
