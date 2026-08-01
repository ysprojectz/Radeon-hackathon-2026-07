declare module "jest-axe" {
  export function axe(container: Element | string): Promise<{ violations: unknown[] }>;
}
