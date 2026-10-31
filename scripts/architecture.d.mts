export function slug(s: string): string;
export function render(md: string): { title: string; body: string; headings: { id: string; text: string }[] };
export function page(md: string, style: string): string;
export function build(): string;
