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

export function pageIcon(name: PageIcon | undefined): Icon {
  return name ? ICONS[name] : Folder;
}
