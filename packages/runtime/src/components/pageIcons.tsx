import {
  Calendar,
  ChartBar,
  ChartLine,
  Coins,
  Files,
  Flask,
  Folder,
  Gear,
  Heart,
  House,
  type Icon,
  ListBullets,
  Pulse,
  Table,
  Wallet,
} from "@phosphor-icons/react";
import type { PageIcon } from "@openislands/schema";

const ICONS: Record<PageIcon, Icon> = {
  house: House,
  "chart-line": ChartLine,
  "chart-bar": ChartBar,
  wallet: Wallet,
  coins: Coins,
  heart: Heart,
  pulse: Pulse,
  table: Table,
  files: Files,
  folder: Folder,
  calendar: Calendar,
  "list-bullets": ListBullets,
  gear: Gear,
  flask: Flask,
};

/**
 * Resolve a curated icon by its kebab name, falling back to a folder for unknown
 * or missing names. Lenient on input (page icons are typed {@link PageIcon};
 * content.editor group icons are a free-form string) but the rendered set stays
 * the curated {@link ICONS} map — a tree-shaken handful, never the whole barrel.
 */
export function pageIcon(name: string | undefined): Icon {
  return (name && ICONS[name as PageIcon]) || Folder;
}
