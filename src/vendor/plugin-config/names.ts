/** The roles a plugin's config pages and properties are named by (docs: the plugin config convention). */
export type PageRole = "views" | "settings" | "state";
export type KeyRole = "view-config" | "ui-state" | "settings";

const slug = (plugin: string): string => {
  const s = plugin.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!s) throw new Error("A plugin name is needed to name config pages and properties");
  return s;
};

/** `Plugin <role>: <Plugin name>`: one page per role, the shared prefix groups every plugin's pages together. */
export function pageTitle(role: PageRole, plugin: string): string {
  const name = plugin.trim();
  if (!name) throw new Error("A plugin name is needed to name config pages and properties");
  return `Plugin ${role}: ${name}`;
}

/** `<plugin>-<role>`, lower case and hyphenated: the host shows a property by this name. */
export const propertyKey = (plugin: string, role: KeyRole): string => `${slug(plugin)}-${role}`;
